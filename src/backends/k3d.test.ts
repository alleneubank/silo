import { describe, expect, test } from "bun:test";
import { stripDebugOutput, validateK3dArgs } from "./k3d";

describe("owned k3d arguments", () => {
  test("preserves declared mapping grammar, including node filters and protocols", () => {
    expect(() => validateK3dArgs(["--port=48180:80@loadbalancer", "-p", "127.0.0.1:48181:443/tcp@server:0", "--agents", "1"], { HTTP: 48180, HTTPS: 48181 })).not.toThrow();
  });
  test.each(["--network=peer", "--registry-create=peer", "--config=peer.yaml", "--runtime-label=io.silo.project=peer", "--kubeconfig-update-default=true", "--api-port=3000"])("refuses identity/ownership escape %s", arg => {
    expect(() => validateK3dArgs([arg], { HTTP: 3000 })).toThrow("silo owns");
  });
  test.each(["--port=3001:80", "--port=80", "--port=0:80", "--port=3000:0"])("refuses unclaimed publication %s", arg => {
    expect(() => validateK3dArgs([arg], { HTTP: 3000 })).toThrow("declared allocated host port");
  });
  test("filters diagnostic lines without changing kubeconfig data", () => {
    expect(stripDebugOutput("DEBU[0000] command\napiVersion: v1\nkind: Config\n")).toBe("apiVersion: v1\nkind: Config\n");
  });
});
