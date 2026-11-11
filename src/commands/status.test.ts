import { expect, test } from "bun:test";
import { observedLaunch } from "./status";
import { LaunchSchema } from "../core/lease_types";
import type { ExecutorCompletion } from "../core/lease_types";
import { processAbsent } from "../core/lease_store";

const grant = (pid: number) => LaunchSchema.parse({
  id: "status-launch", kind: "tilt-ci", command: ["tilt", "ci"], effect: "workload",
  phase: "granted", supervisorPid: pid, leaderPid: pid, groupId: pid,
  supervisorIdentity: "recorded-identity", exitCode: null, terminal: false, reconciled: false,
});

test("an absent recorded group without a completion has an unknown result", async () => {
  const child = Bun.spawn(["/usr/bin/true"], { detached: true, stdout: "ignore", stderr: "ignore" });
  await child.exited;
  expect(processAbsent(child.pid)).toBe(true);
  const launch = grant(child.pid);
  expect(observedLaunch(launch, null)).toEqual({ launchId: launch.id, state: "terminated", groupsAbsent: true, completion: null });
  expect(launch).toMatchObject({ phase: "granted", terminal: false, reconciled: false, exitCode: null });
});

test("a live or recycled recorded PID does not prove group absence", () => {
  const launch = grant(process.pid);
  expect(observedLaunch(launch, null)).toEqual({ launchId: launch.id, state: "live-or-unknown", groupsAbsent: false, completion: null });
});

test("stored terminal and exit facts survive a recycled PID", () => {
  const launch = grant(process.pid);
  expect(observedLaunch(LaunchSchema.parse({ ...launch, terminal: true }), null).state).toBe("terminated");
  const exited = LaunchSchema.parse({ ...launch, phase: "exited", terminal: true, started: true, exitCode: 143 });
  expect(observedLaunch(exited, null)).toMatchObject({ state: "completed", groupsAbsent: false });
});

test("a durable completion can precede process-group disappearance", () => {
  const launch = grant(process.pid);
  const completion: ExecutorCompletion = {
    projectId: "project", generation: 1, launchId: launch.id, leaderPid: process.pid, groupId: process.pid,
    started: true, exitCode: 143, completedAt: "2026-11-09T00:00:00Z",
  };
  expect(observedLaunch(launch, completion)).toEqual({ launchId: launch.id, state: "completed", groupsAbsent: false, completion });
});

test("an ungranted plan has no observable process identity", () => {
  const launch = LaunchSchema.parse({ ...grant(process.pid), phase: "planned", supervisorPid: null, supervisorIdentity: null, leaderPid: null, groupId: null });
  expect(observedLaunch(launch, null)).toEqual({ launchId: launch.id, state: "unconfirmed", groupsAbsent: false, completion: null });
});
