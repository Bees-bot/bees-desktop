#!/usr/bin/env bash
# builds on GitHub, signs updates and publishes a release. see docs/releases.md.
#   scripts/release.sh prepare 0.2.1   opens the PR that sets the version and turns Unreleased into its notes
#   npm run release                   after that PR is merged: builds main and publishes it as the latest release
set -euo pipefail
cd "$(dirname "$0")/.."

repo=Bees-bot/bees-desktop
key=../bees-signing/bees-updater.key
die() { echo "stop: $*" >&2; exit 1; }
# the line here drops for a minute at a time, so every long network call gets retried
try() { for n in 1 2 3 4 5 6; do "$@" && return; sleep 60; done; die "kept failing: $*"; }

case ${1:-} in
prepare)
  version=${2:-}
  [[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "usage: $0 prepare 0.2.1"
  git fetch -q origin main
  # a throwaway checkout, so whatever branch this repo is on stays untouched
  dir=$(mktemp -d)
  git worktree add -q --detach "$dir" origin/main
  trap "git -C '$PWD' worktree remove --force '$dir'" EXIT
  cd "$dir"
  grep -qx "## Unreleased" CHANGELOG.md || die "CHANGELOG.md on main has no ## Unreleased notes."
  npm version "$version" --no-git-tag-version --ignore-scripts --allow-same-version >/dev/null
  sed -i '' "s/^  \"version\": \".*\"/  \"version\": \"$version\"/" src-tauri/tauri.conf.json
  sed -i '' "1,/^version = /s/^version = \".*\"/version = \"$version\"/" src-tauri/Cargo.toml
  perl -0pi -e "s/(name = \"bees-desktop\"\nversion = \")[^\"]+/\${1}$version/" src-tauri/Cargo.lock
  sed -i '' "s/^## Unreleased$/## $version/" CHANGELOG.md
  git add package.json package-lock.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock CHANGELOG.md
  git commit -qm "release v$version"
  git push -q origin "HEAD:refs/heads/release/v$version"
  gh pr create --repo $repo --base main --head "release/v$version" --title "release v$version" \
    --body "Sets the app version to $version and turns the Unreleased notes into the $version notes. Merging releases nothing, scripts/release.sh publish does."
  ;;
publish)
  node scripts/check-node.mjs
  git fetch -q origin main
  [[ $(git rev-parse --abbrev-ref HEAD) == main && -z $(git status --porcelain) ]] || die "switch to a clean main first."
  sha=$(git rev-parse HEAD)
  [[ $sha == $(git rev-parse origin/main) ]] || die "main is not the same as origin/main. pull first."
  version=$(node -p 'require("./package.json").version')
  tag=v$version
  grep -q "^  \"version\": \"$version\"" src-tauri/tauri.conf.json && grep -q "^version = \"$version\"" src-tauri/Cargo.toml \
    || die "package.json, tauri.conf.json and Cargo.toml disagree on the version."
  notes=$(awk -v h="## $version" '$0 == h { on = 1; next } /^## / { on = 0 } on' CHANGELOG.md)
  [[ -n ${notes//[[:space:]]/} ]] || die "CHANGELOG.md has no ## $version notes."
  notes="Choose your download from **Assets** below:
- **Mac:** choose Apple silicon or Intel. Check Apple menu > About This Mac for your chip or processor.
- **Windows:** choose the .exe installer for Intel/AMD 64-bit computers.
- **Linux:** choose the .deb installer if your distribution uses DEB packages, or the standalone .AppImage to run without installing a DEB package. Both are for Intel/AMD 64-bit computers. Ubuntu 22.04 and 24.04 are covered by our installation checks; other distributions are unverified. AppImage still requires compatible system libraries.
- Files marked **Automatic update only** are used by Bees itself. They are not installers.

### Changes

$notes"
  rc=0; git ls-remote --exit-code --tags origin "refs/tags/$tag" >/dev/null || rc=$?
  [[ $rc == 2 ]] || die "$tag already exists or github could not be reached. a used version is never reused."
  [[ -r $key && -r $key.password ]] || die "the updater key is missing from ../bees-signing."
  caffeinate -i -w $$ &
  out=$(mktemp -d)
  # a failed run should not leave github building for nothing
  trap 'gh run cancel "${run:-0}" --repo $repo >/dev/null 2>&1; rm -rf "$out"' EXIT

  # all platforms build from the same commit; Mac jobs also sign and notarize their installers
  run=$(gh workflow run build.yml --repo $repo --ref main -f sha="$sha" | grep -o 'runs/[0-9]*' | cut -d/ -f2) || die "github did not start the build."

  try gh run watch "$run" --repo $repo --interval 60 --exit-status >/dev/null
  # curl resumes each zip after a drop, and set -e is off inside try, hence the returns
  ci() {
    gh api "repos/$repo/actions/runs/$run/artifacts" --jq '.artifacts[] | "\(.id) \(.name)"' > "$out/artifacts" || return
    while read -r id name; do
      curl -fsSL -C - --retry 30 --retry-all-errors --retry-delay 20 --speed-limit 1024 --speed-time 60 \
        -H @<(echo "Authorization: Bearer $(gh auth token)") -o "$out/$id.zip" "https://api.github.com/repos/$repo/actions/artifacts/$id/zip" || return
      rm -rf "$out/ci/$name"; mkdir -p "$out/ci"; unzip -oq "$out/$id.zip" -d "$out/ci/$name" || { rm -f "$out/$id.zip"; return 1; }
    done < "$out/artifacts"
  }
  try ci
  while IFS= read -r -d '' file; do
    case "$file" in
      */macos-15/Bees.app.tar.gz) destination="Bees_${version}_aarch64.app.tar.gz" ;;
      */macos-15-intel/Bees.app.tar.gz) destination="Bees_${version}_x64.app.tar.gz" ;;
      */macos-15/*.dmg) destination="Bees_${version}_aarch64.dmg" ;;
      */macos-15-intel/*.dmg) destination="Bees_${version}_x64.dmg" ;;
      *-setup.exe) destination="Bees_${version}_x64-setup.exe" ;;
      *.AppImage) destination="Bees_${version}_amd64.AppImage" ;;
      *.deb) destination="Bees_${version}_amd64.deb" ;;
      *) die "unexpected build artifact: $file" ;;
    esac
    mv "$file" "$out/$destination"
  done < <(find "$out/ci" \( -name "Bees.app.tar.gz" -o -name "*.dmg" -o -name "*-setup.exe" -o -name "*.AppImage" -o -name "*.deb" \) -print0)

  updates=("Bees_${version}_aarch64.app.tar.gz" "Bees_${version}_x64.app.tar.gz" "Bees_${version}_x64-setup.exe" "Bees_${version}_amd64.AppImage" "Bees_${version}_amd64.deb")
  # 2.12 binds each signature to the version, which requireSignedVersion in tauri.conf.json checks
  for file in "${updates[@]}"; do
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD=$(cat "$key.password") try npx -y @tauri-apps/cli@2.12.1 signer sign --app-version "$version" -f "$key" "$out/$file"
  done
  V=$version BASE=https://github.com/$repo/releases/download/$tag OUT=$out node -e '
    const { V: version, BASE, OUT } = process.env;
    const entry = (file) => ({ signature: require("fs").readFileSync(`${OUT}/${file}.sig`, "utf8").trim(), url: `${BASE}/${file}` });
    console.log(JSON.stringify({ version, pub_date: new Date().toISOString(), platforms: {
      "darwin-aarch64": entry(`Bees_${version}_aarch64.app.tar.gz`),
      "darwin-x86_64": entry(`Bees_${version}_x64.app.tar.gz`),
      "windows-x86_64": entry(`Bees_${version}_x64-setup.exe`),
      "linux-x86_64": entry(`Bees_${version}_amd64.AppImage`),
      "linux-x86_64-deb": entry(`Bees_${version}_amd64.deb`),
    } }, null, 2));
  ' > "$out/bees-update.json"
  files=("Bees_${version}_aarch64.dmg" "Bees_${version}_x64.dmg" "${updates[@]}")
  (cd "$out" && shasum -a 256 "${files[@]}" > SHA256SUMS)
  downloads=src-tauri/target/releases/$version
  mkdir -p "$downloads"
  for download in "${files[@]}" bees-update.json SHA256SUMS; do cp "$out/$download" "$downloads/"; done
  (cd "$downloads" && shasum -a 256 -c SHA256SUMS)
  echo "downloads: $PWD/$downloads"

  # gh deletes a draft whose upload dies, so the draft starts empty and each file retries on its own
  trap - EXIT
  draft() { gh release view "$tag" --repo $repo >/dev/null 2>&1 || gh release create "$tag" --repo $repo --target "$sha" --title "Bees $tag" --notes "$notes" --draft; }
  try draft
  [[ $(try gh release view "$tag" --repo $repo --json isDraft --jq .isDraft) == true ]] || die "$tag is published; refusing to replace its files."
  for file in "${files[@]}" bees-update.json SHA256SUMS; do
    # GitHub displays the label after #; filenames stay stable for updates and install checks.
    case "$file" in
      *_aarch64.dmg) label="Mac (Apple silicon) - installer (.dmg)" ;;
      *_x64.dmg) label="Mac (Intel) - installer (.dmg)" ;;
      *_x64-setup.exe) label="Windows (Intel/AMD 64-bit) - installer (.exe)" ;;
      *_amd64.deb) label="Linux (Intel/AMD 64-bit) - DEB installer (.deb)" ;;
      *_amd64.AppImage) label="Linux (Intel/AMD 64-bit) - standalone app (.AppImage)" ;;
      *_aarch64.app.tar.gz) label="Automatic update only - Mac (Apple silicon)" ;;
      *_x64.app.tar.gz) label="Automatic update only - Mac (Intel)" ;;
      bees-update.json) label="Automatic update only - manifest (.json)" ;;
      SHA256SUMS) label="SHA-256 checksums (not an installer)" ;;
    esac
    try gh release upload "$tag" --repo $repo --clobber "$out/$file#$label"
  done
  # a draft left by an earlier run may point at an older commit
  try gh release edit "$tag" --repo $repo --target "$sha" --notes "$notes" --draft=false --latest
  rm -rf "$out"
  live=$(curl -fsSL https://github.com/$repo/releases/latest/download/bees-update.json | node -p 'JSON.parse(require("fs").readFileSync(0)).version') \
    || die "$tag is published but bees-update.json could not be read back."
  [[ $live == "$version" ]] || die "$tag is published but strangers are offered '$live'."
  echo "done: https://github.com/$repo/releases/tag/$tag"
  ;;
*) die "usage: $0 prepare 0.2.1 | publish" ;;
esac
