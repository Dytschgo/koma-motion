#!/usr/bin/env bash
# Installs the latest stable release of Koma Motion on macOS, or a selected
# stable or nightly release when KOMA_MOTION_RELEASE_TAG is set.
#
#   curl -fsSL https://raw.githubusercontent.com/Dytschgo/koma-motion/main/scripts/install.sh | bash
#
# KOMA_MOTION_RELEASE_TAG=v0.1.0 installs that release instead of the latest.
# Nightly release pages include a command that sets this to that nightly tag.
# The disk image is checked against the published checksums, the application
# is checked for its ad hoc signature and the required macOS version, and an
# existing application in ~/Applications is kept as a backup.
set -euo pipefail

repository="Dytschgo/koma-motion"
release_tag="${KOMA_MOTION_RELEASE_TAG:-}"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "This installer is for macOS. On Windows, run scripts/install.ps1 in PowerShell." >&2
  exit 1
fi

if [ -n "$release_tag" ]; then
  if ! [[ "$release_tag" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-nightly\.[1-9][0-9]{7}\.[1-9][0-9]*(\.[1-9][0-9]*)?)?$ ]]; then
    echo "KOMA_MOTION_RELEASE_TAG must be a stable or nightly tag such as v0.1.0 or v0.1.1-nightly.20261002.1234." >&2
    exit 1
  fi
  download_base="https://github.com/${repository}/releases/download/${release_tag}"
  image_name="Koma-Motion-${release_tag#v}-universal.dmg"
  description="release ${release_tag}"
else
  download_base="https://github.com/${repository}/releases/latest/download"
  image_name="Koma-Motion.dmg"
  description="the latest stable release"
fi

work="$(mktemp -d)"
mount_point=""

cleanup() {
  if [ -n "$mount_point" ]; then
    hdiutil detach "$mount_point" -quiet 2>/dev/null || true
  fi
  rm -rf "$work"
}
trap cleanup EXIT

echo "Downloading Koma Motion, ${description}..."
if ! curl --fail --location --retry 3 --progress-bar --show-error \
  --output "$work/$image_name" "${download_base}/${image_name}"; then
  echo "The download failed. Nothing was changed. See https://github.com/${repository}/releases" >&2
  exit 1
fi
curl --fail --location --retry 3 --silent --show-error \
  --output "$work/SHA256SUMS.txt" "${download_base}/SHA256SUMS.txt"
(cd "$work" && grep "  ${image_name}\$" SHA256SUMS.txt | shasum -a 256 --check --strict --status) \
  || { echo "The checksum of the download is wrong. Nothing was changed." >&2; exit 1; }

mount_point="$(hdiutil attach "$work/$image_name" -nobrowse -readonly -mountrandom "$work" \
  | awk -F '\t' '/\/Volumes\/|\/private\/|\/var\//{print $NF}' | tail -n 1)"
test -d "$mount_point/Koma Motion.app"

staged="$work/Koma Motion.app"
ditto "$mount_point/Koma Motion.app" "$staged"
hdiutil detach "$mount_point" -quiet
mount_point=""

test -x "$staged/Contents/MacOS/Koma Motion"
codesign --verify --deep --strict "$staged"

minimum="$(/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' "$staged/Contents/Info.plist")"
current="$(/usr/bin/sw_vers -productVersion)"
if ! /usr/bin/awk -v current="$current" -v minimum="$minimum" 'BEGIN {
  split(current, actual, "."); split(minimum, required, ".");
  for (i = 1; i <= 3; i++) {
    if (actual[i] + 0 > required[i] + 0) exit 0;
    if (actual[i] + 0 < required[i] + 0) exit 1;
  }
  exit 0;
}'; then
  echo "This release needs macOS ${minimum} or newer. This Mac has ${current}. Nothing was changed." >&2
  exit 1
fi

target_dir="$HOME/Applications"
target="$target_dir/Koma Motion.app"
mkdir -p "$target_dir"
if [ -e "$target" ]; then
  backup="$target_dir/Koma Motion-backup-$(date +%Y%m%d-%H%M%S).app"
  mv "$target" "$backup"
  echo "The previous application is kept at: $backup"
fi
if ! ditto "$staged" "$target"; then
  echo "Copying the application failed. Your projects are unchanged." >&2
  exit 1
fi

echo "Koma Motion is installed at: $target"
echo "It is not notarised. If macOS refuses to open it, choose \"Open Anyway\" in"
echo "System Settings > Privacy & Security, then open it again."
open "$target"
