#!/bin/sh
# Install the reviewed CLI for the current macOS or Linux user.
set -eu

fail() {
    printf 'tolk installer: %s\n' "$*" >&2
    exit 1
}

download() {
    curl --disable --fail --silent --show-error --location \
        --proto '=https' --proto-redir '=https' --output "$2" "$1"
}

check_digest() {
    if command -v sha256sum >/dev/null 2>&1; then
        actual=$(sha256sum < "$1")
    else
        actual=$(shasum -a 256 < "$1")
    fi
    [ "${actual%% *}" = "$2" ] || fail "checksum mismatch for $1"
}

install_tolk() {
    [ "$#" -eq 0 ] || fail 'usage: sh install.sh'
    version=v0.1.0
    release="https://github.com/randock/tolk-action/releases/download/cli-$version"
    manifest_digest=421e191fa098b324a8dff3253acf2f26e1652ed0e8cb8b526c71ed984c0d3b92
    system=$(uname -s)
    machine=$(uname -m)
    case "$system/$machine" in
        Darwin/x86_64) target=darwin-amd64; verifier_digest=9d1e4abe2b6be279ed0d2ff706fde1ccd738747c834e3e6d44039c238867334f ;;
        Darwin/arm64) target=darwin-arm64; verifier_digest=9f9b8cd557cf2e5b3df3373a00baa005a86b02391e3e06dd0ce37b3a1533d3a4 ;;
        Linux/x86_64) target=linux-amd64; verifier_digest=424e2c97d0b45fd7a6b608a87f090f35633f4c23ece5f092d48bba11aaf4bbfa ;;
        Linux/aarch64|Linux/arm64) target=linux-arm64; verifier_digest=ade83b7aac62e131cacfe96d958948b2150cc9efec46a570a2649b8e27dedad2 ;;
        *) fail "unsupported platform: $system $machine (requires macOS or Linux on x86_64 or arm64)" ;;
    esac
    command -v curl >/dev/null 2>&1 || fail 'install curl first'
    command -v sha256sum >/dev/null 2>&1 || command -v shasum >/dev/null 2>&1 || fail 'install sha256sum or shasum first'

    case "${HOME:-}" in /*) ;; *) fail 'HOME must be an absolute path' ;; esac
    bin="$HOME/.local/bin"
    umask 077
    if [ -L "$bin/tolk" ] || { [ -e "$bin/tolk" ] && [ ! -f "$bin/tolk" ]; }; then
        fail "expected a regular file at $bin/tolk"
    fi
    mkdir -p "$bin" || fail "cannot create $bin"
    work=$(mktemp -d "$bin/.tolk-install.XXXXXXXX") || fail "cannot stage the install in $bin"
    trap 'rm -rf "$work"' EXIT
    trap 'exit 1' HUP INT TERM
    cd "$work"

    download "$release/SHA256SUMS" SHA256SUMS
    check_digest SHA256SUMS "$manifest_digest"
    download "$release/SHA256SUMS.sigstore.json" SHA256SUMS.sigstore.json
    download "https://github.com/sigstore/cosign/releases/download/v3.1.4/cosign-$target" cosign
    check_digest cosign "$verifier_digest"
    chmod 700 cosign
    env -i PATH="$PATH" HOME="$work" HTTPS_PROXY="${HTTPS_PROXY:-}" \
        HTTP_PROXY="${HTTP_PROXY:-}" NO_PROXY="${NO_PROXY:-}" \
        ./cosign verify-blob --bundle SHA256SUMS.sigstore.json \
        --certificate-identity "https://github.com/randock/tolk/.github/workflows/cli-release.yml@refs/tags/cli-$version" \
        --certificate-oidc-issuer https://token.actions.githubusercontent.com SHA256SUMS \
        || fail 'release signature verification failed'

    name="tolk-$target"
    digest=$(awk -v name="$name" '$2 == name { print $1 }' SHA256SUMS)
    download "$release/$name" "$name"
    check_digest "$name" "$digest"
    chmod 755 "$name"
    mv -f "$name" "$bin/tolk"
    printf 'Installed Tolk %s at %s/tolk\n' "$version" "$bin"
    # Print the literal export for use in future shells.
    # shellcheck disable=SC2016
    case ":${PATH:-}:" in
        *":$bin:"*) ;;
        *) printf '%s\n' 'Add this line to your shell profile and run it in this shell:' 'export PATH="$HOME/.local/bin:$PATH"' ;;
    esac
}

install_tolk "$@"
