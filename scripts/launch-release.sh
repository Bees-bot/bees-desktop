#!/usr/bin/env bash
# launch day release. refuses to do anything until Bees-bot/bees-desktop is public.
#   scripts/launch-release.sh prepare 0.2.0   opens the PR that sets the version and release notes
#   scripts/launch-release.sh ship 0.2.0      after that PR is merged: tags main, waits for the build, checks strangers can download
set -euo pipefail
cd "$(dirname "$0")/.."

repo=Bees-bot/bees-desktop
cmd=${1:-}
version=${2:-}
tag=v$version
die() { echo "stop: $*" >&2; exit 1; }

[[ $cmd =~ ^(prepare|ship)$ && $version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "usage: $0 prepare|ship 0.2.0"
[[ $(gh repo view $repo --json visibility -q .visibility) == PUBLIC ]] || die "$repo is still private. make it public first."

rc=0; git ls-remote --exit-code --tags origin "refs/tags/$tag" >/dev/null || rc=$?
[[ $rc == 2 ]] || die "$tag already exists or github could not be reached. a used tag is never reused, pick the next version."

secrets=$(gh secret list --repo $repo --json name -q '.[].name')
for s in APPLE_SIGNING_IDENTITY APPLE_CERTIFICATE APPLE_CERTIFICATE_PASSWORD APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID; do
  grep -qx "$s" <<<"$secrets" || die "secret $s is missing, so the mac build would ship unsigned."
done
grep -qx DISCORD_RELEASE_WEBHOOK <<<"$secrets" \
  || echo "note: DISCORD_RELEASE_WEBHOOK is not set. the release still goes out, only the discord post fails."

git fetch -q origin main

if [[ $cmd == prepare ]]; then
  # a throwaway checkout, so whatever branch this repo is on stays untouched
  dir=$(mktemp -d)
  git worktree add -q --detach "$dir" origin/main
  trap 'git worktree remove --force "$dir"' EXIT
  (cd "$dir" && node scripts/release.mjs version "$version")
  git -C "$dir" add package.json package-lock.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock CHANGELOG.md
  git -C "$dir" commit -qm "release $tag"
  git -C "$dir" push -q origin "HEAD:refs/heads/release/$tag"
  gh pr create --repo $repo --base main --head "release/$tag" --title "release $tag" \
    --body "Sets the app version to $version and turns the Unreleased notes into the $version notes. Merging this releases nothing. The build starts when the $tag tag is pushed."
  echo "once that PR is merged, run: scripts/launch-release.sh ship $version"
  exit
fi

git show origin/main:package.json | grep -q "\"version\": \"$version\"" || die "main is not at $version yet. merge the prepare PR first."
git show origin/main:CHANGELOG.md | grep -qx "## $version" || die "CHANGELOG.md on main has no ## $version section."
[[ -z $(gh run list --repo $repo --workflow release.yml --status in_progress --json databaseId -q '.[].databaseId') ]] \
  || die "another release build is still running. wait for it first."

git tag -af "$tag" origin/main -m "Bees $tag"
git push -q origin "refs/tags/$tag"
echo "pushed $tag. the build takes about an hour."

run=
for _ in {1..30}; do
  run=$(gh run list --repo $repo --workflow release.yml --branch "$tag" --limit 1 --json databaseId -q '.[0].databaseId')
  [[ -n $run ]] && break
  sleep 5
done
[[ -n $run ]] || die "no release build started. look at https://github.com/$repo/actions"
url=https://github.com/$repo/actions/runs/$run

watched=0; gh run watch "$run" --repo $repo --interval 60 --exit-status || watched=$?
[[ $(gh release view "$tag" --repo $repo --json isDraft -q .isDraft 2>/dev/null) == false ]] \
  || die "the build failed before publishing, so nothing went public. fix it and use re-run failed jobs: $url"
[[ $watched == 0 ]] || echo "note: $tag is live, but a step after publishing failed (usually the discord post). rerun only that job: $url"

# the website download page reads this same unauthenticated endpoint
latest=$(curl -fsS https://api.github.com/repos/$repo/releases/latest | grep -o '"tag_name": *"[^"]*"' | cut -d'"' -f4)
[[ $latest == "$tag" ]] || die "$tag is published but strangers see '$latest' as the latest release."
echo "done. $tag is public: https://github.com/$repo/releases/tag/$tag"
echo "now install it on a mac, windows and linux machine and open it once. a build that packages fine can still fail to start."
