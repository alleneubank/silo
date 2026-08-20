{
  description = "silo development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.11";

    bun-overlay.url = "github:alleneubank/bun-overlay";
    bun-overlay.inputs.nixpkgs.follows = "nixpkgs";

    tilt-overlay.url = "github:alleneubank/tilt-overlay";
    tilt-overlay.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs = { self, nixpkgs, bun-overlay, tilt-overlay }:
    let
      tiltForkVersion = "0.37.7-fork.20260819.gfa564bca6";
      tiltForkSystems = [ "x86_64-linux" "x86_64-darwin" "aarch64-darwin" ];
      tiltForkOverlay = _: prev:
        let
          system = prev.stdenv.hostPlatform.system;
        in
        prev.lib.optionalAttrs (builtins.elem system tiltForkSystems) {
          tilt = (import "${tilt-overlay}/default.nix" {
            inherit system;
            pkgs = prev;
            tiltVersion = tiltForkVersion;
          }).tilt;
        };
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];

      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f system);
    in
    {
      devShells = forAllSystems (system:
        let
          pkgs = import nixpkgs {
            inherit system;
            overlays = [
              bun-overlay.overlays.default
              tiltForkOverlay
            ];
          };
        in
        {
          default = pkgs.mkShell {
            packages = [
              pkgs.bun
              pkgs.fnm
              pkgs.k3d
              pkgs.kubectl
              pkgs.tilt
              pkgs.docker
              pkgs.docker-compose
              pkgs.git
              pkgs.bash
              pkgs.coreutils
            ];

            shellHook = ''
              eval "$(fnm env --use-on-cd)"
            '';
          };
        });
    };
}
