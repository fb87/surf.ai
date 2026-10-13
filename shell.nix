{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  name = "surfai-build";
  buildInputs = [
    pkgs.esbuild
    pkgs.nodejs
  ];
  shellHook = ''
    echo "surf.ai build shell ready. Run: node build.js"
  '';
}
