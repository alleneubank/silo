# Guest resources

Only the immutable guest package was executed. Public operation process groups and deadlines are recorded in `processes.txt`; journaled child PIDs/groups are in the status captures. `recorded-processes-after.txt` records no remaining PID among those recorded at the end of both transitions.

## k3d project

Project: c9217b10-761b-4dde-a027-2294d4f75e4e, generation 1, root `/tmp/guest/kube-switch`, cluster `guest-kube1104`.

| Kind | Exact handle | Teardown |
| --- | --- | --- |
| Container | 09c761eada2d0fc40bd9b2bbe3250e0f9e54ec75e182550dbc43e5b110c7d136 | Public down --delete-cluster; subsequently absent |
| Container | a3f485a044202e46a5b4a375e25734ef5d636fe0ad0d4d2e51a3bc8f8b469406 | Public down --delete-cluster; subsequently absent |
| Network | e1cc7e49731652eafe3e5a33a216d63248c43bc727a668e980ad25697ecb84e8, k3d-guest-kube1104 | Public down --delete-cluster; subsequently absent |
| Volume | k3d-guest-kube1104-images | Public down --delete-cluster; subsequently absent |
| Anonymous /var/log volume | 3f17cf3dd0eac71b6e65bfb956a029a10083c2a6ad26e1b9b43ef4ed58a2d8cf | Exact recorded server mount; absent after public deletion |
| Anonymous /var/lib/cni volume | f26d086c6cd4883065de6e6f86aa797f8c4fb0cc1591dfa913794fd5b162acf1 | Exact recorded server mount; absent after public deletion |
| Anonymous /var/lib/kubelet volume | 8eb737d4937c4c3ee1e8ee77a651a92a07d4c83418b03f84c4eaf135a5aecfbc | Exact recorded server mount; absent after public deletion |
| Anonymous /var/lib/rancher/k3s volume | 768871edca002e092c3a001a257760e5681a439a61eb9ddeda8a88cffe248a92 | Exact recorded server mount; absent after public deletion |

`kube-mounts.txt` contains allowlisted IDs, names, creation time and mounts only. No full Docker inspect or kubeconfig bytes were captured. The original kubeconfig, env and lock were removed with public down --delete-cluster --clean after the configuration edit. The disabled replacement generation was also cleaned, leaving `phase: unallocated` and empty claims/resources/files.

## Other guest projects

`/tmp/guest/case-switch`: original and replacement output snapshots cleaned through public down --delete-cluster --clean. Final `phase: unallocated` and empty claims/resources/files. Repeated final clean succeeded without effects.

`/tmp/guest/sentinel`: only env was allocated; its generated output, lock and marker stayed byte-for-byte unchanged throughout both other transitions. Final cleanup initially blocked on a new non-guest listener on port 49152. Read-only attribution found Docker container a898b661941b, k3d-localnet-atomic-r1-example-serverlb. Its owner confirmed it was their fixture and handled teardown. The guest did not signal or delete that resource.

After the other owner released port 49152, sentinel public down --delete-cluster --clean succeeded. Final sentinel status is unallocated with empty claims/resources/files; original env and lock are absent, unrelated marker unchanged. No recorded public-operation PID remains.
