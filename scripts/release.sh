#!/usr/bin/env bash
# builds, signs and publishes a release for every platform from this Mac. see docs/releases.md.
#   scripts/release.sh prepare 0.2.1   opens the PR that sets the version and turns Unreleased into its notes
#   scripts/release.sh publish         after that PR is merged: builds main and publishes it as the latest release
set -euo pipefail
cd "$(dirname "$0")/.."

repo=Bees-bot/bees-desktop
identity="Developer ID Application: FunCove LLC (T9AGT95JD7)"
key=../bees-signing/bees-updater.key
die() { echo "stop: $*" >&2; exit 1; }
notarize() { xcrun notarytool submit "$1" --keychain-profile bees-notary --wait | tee /dev/stderr | grep "status: Accepted" >/dev/null || die "apple rejected $1"; }
# notarizes and staples an app, then makes its update package and disk image in $out
mac() {
  local app=$1 name=Bees_${version}_$2
  ditto -c -k --keepParent "$app" "$out/$name.zip"
  notarize "$out/$name.zip"
  xcrun stapler staple "$app"
  COPYFILE_DISABLE=1 tar -czf "$out/$name.app.tar.gz" -C "$(dirname "$app")" Bees.app
  rm -rf "$out/dmg" && mkdir "$out/dmg"
  cp -R "$app" "$out/dmg/"
  ln -s /Applications "$out/dmg/Applications"
  hdiutil create -quiet -volname Bees -srcfolder "$out/dmg" -format UDZO "$out/$name.dmg"
  codesign --sign "$identity" --timestamp "$out/$name.dmg"
  notarize "$out/$name.dmg"
  xcrun stapler staple "$out/$name.dmg"
  spctl --assess --type open --context context:primary-signature "$out/$name.dmg"
}

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
  # the build copies this node into the app as its runtime
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
  rc=0; git ls-remote --exit-code --tags origin "refs/tags/$tag" >/dev/null || rc=$?
  [[ $rc == 2 ]] || die "$tag already exists or github could not be reached. a used version is never reused."
  [[ -r $key && -r $key.password ]] || die "the updater key is missing from ../bees-signing."
  out=$(mktemp -d)
  trap 'rm -rf "$out"' EXIT

  # this Mac cannot build Intel, Linux or Windows, so github builds those while it builds Apple Silicon
  run=$(gh workflow run build.yml --repo $repo --ref main -f sha="$sha" | grep -o 'runs/[0-9]*' | cut -d/ -f2) || die "github did not start the build."
  npm ci
  APPLE_SIGNING_IDENTITY=$identity npx tauri build --bundles app
  mac src-tauri/target/release/bundle/macos/Bees.app aarch64

  gh run watch "$run" --repo $repo --interval 60 --exit-status >/dev/null || die "the github build failed: https://github.com/$repo/actions/runs/$run"
  gh run download "$run" --repo $repo --dir "$out/ci"
  mkdir "$out/intel"
  tar -xzf "$out/ci/macos-15-intel/Bees.app.tar.gz" -C "$out/intel"
  mac "$out/intel/Bees.app" x64
  find "$out/ci" \( -name "*-setup.exe" -o -name "*.AppImage" -o -name "*.deb" \) -exec mv {} "$out" \;

  updates=("Bees_${version}_aarch64.app.tar.gz" "Bees_${version}_x64.app.tar.gz" "Bees_${version}_x64-setup.exe" "Bees_${version}_amd64.AppImage" "Bees_${version}_amd64.deb")
  # 2.12 binds each signature to the version, which requireSignedVersion in tauri.conf.json checks
  for file in "${updates[@]}"; do
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD=$(cat "$key.password") npx -y @tauri-apps/cli@2.12.1 signer sign --app-version "$version" -f "$key" "$out/$file"
  done
  # a new file name on purpose: 0.1.1 still polls latest.json here and must never be offered this build
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

  gh release create "$tag" --repo $repo --target "$sha" --title "Bees $tag" --notes "$notes" --latest \
    "${files[@]/#/$out/}" "$out/bees-update.json" "$out/SHA256SUMS"
  live=$(curl -fsSL https://github.com/$repo/releases/latest/download/bees-update.json | node -p 'JSON.parse(require("fs").readFileSync(0)).version') \
    || die "$tag is published but bees-update.json could not be read back."
  [[ $live == "$version" ]] || die "$tag is published but strangers are offered '$live'."
  echo "done: https://github.com/$repo/releases/tag/$tag"
  ;;
*) die "usage: $0 prepare 0.2.1 | publish" ;;
esac
