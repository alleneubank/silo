import config from "../../docs/silo-toml.md" with { type: "text" };
import profiles from "../../docs/profiles.md" with { type: "text" };
import commands from "../../docs/commands.md" with { type: "text" };
import lockfile from "../../docs/lockfile.md" with { type: "text" };
import interpolation from "../../docs/interpolation.md" with { type: "text" };
import ports from "../../docs/ports.md" with { type: "text" };
import hosts from "../../docs/hosts.md" with { type: "text" };
import urls from "../../docs/urls.md" with { type: "text" };
import k3d from "../../docs/k3d.md" with { type: "text" };
import hooks from "../../docs/hooks.md" with { type: "text" };
import logging from "../../docs/logging.md" with { type: "text" };
import troubleshooting from "../../docs/troubleshooting.md" with { type: "text" };
import tilt from "../../docs/tilt.md" with { type: "text" };

type DocTopicEntry = {
  file: string;
  description: string;
  contents: string;
};

export const DOC_TOPICS: Record<string, DocTopicEntry> = {
  config: { file: "silo-toml.md", description: "silo.toml reference", contents: config },
  profiles: { file: "profiles.md", description: "Profile configuration", contents: profiles },
  commands: { file: "commands.md", description: "CLI command reference", contents: commands },
  lockfile: { file: "lockfile.md", description: "Lockfile format and behavior", contents: lockfile },
  interpolation: { file: "interpolation.md", description: "Template variables and phases", contents: interpolation },
  ports: { file: "ports.md", description: "Port allocation and validation", contents: ports },
  hosts: { file: "hosts.md", description: "Hostnames and browser isolation", contents: hosts },
  urls: { file: "urls.md", description: "URL templates and derived vars", contents: urls },
  k3d: { file: "k3d.md", description: "k3d cluster integration", contents: k3d },
  hooks: { file: "hooks.md", description: "Lifecycle hooks", contents: hooks },
  logging: { file: "logging.md", description: "Logging behavior and verbosity", contents: logging },
  troubleshooting: { file: "troubleshooting.md", description: "Common errors and fixes", contents: troubleshooting },
  tilt: { file: "tilt.md", description: "Tilt integration and expectations", contents: tilt },
};

export const DOC_TOPIC_ALIASES: Record<string, keyof typeof DOC_TOPICS> = {
  "silo.toml": "config",
};
