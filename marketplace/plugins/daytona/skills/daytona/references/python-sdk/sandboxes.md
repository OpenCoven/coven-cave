## Contents

- Create sandboxes
- VM sandboxes
- GPU sandboxes
- Ephemeral sandboxes
- Linked sandboxes
- Start sandboxes
- Get sandbox
- List sandboxes
- Stop sandboxes
- Archive sandboxes
- Pause / resume sandboxes
- Recover sandboxes
- Resize sandboxes
- Label sandboxes
- Delete sandboxes
- Create snapshot from sandbox
- Fork sandboxes
- Sandbox lifecycle
- Automated lifecycle management




Daytona provides **full composable computers** — **sandboxes** — for AI agents. Sandboxes are isolated runtime environments you can manage programmatically to run code. Each sandbox runs in isolation, giving it a dedicated kernel, filesystem, network stack, and allocated vCPU, RAM, and disk. Agents and developers get access to a full composable computer where they can install packages, run servers, compile code, and manage processes.

Sandboxes run as **Linux containers** by default. Daytona also provides [VM sandboxes](#vm-sandboxes) with a dedicated **Linux VM** or **Windows** operating system, and [GPU sandboxes](#gpu-sandboxes) with **NVIDIA GPU** acceleration for model inference, fine-tuning, and CUDA-accelerated compute.

## Create sandboxes

Create a sandbox.

1. Go to [Daytona Sandboxes ↗](https://app.daytona.io/dashboard/sandboxes)
2. Click <Button>Create Sandbox</Button>
3. Click <Button>Create</Button>

```python
from daytona import Daytona

daytona = Daytona()
sandbox = daytona.create()
```

### Snapshots

Create a sandbox from a [default snapshot](./snapshots.md#default-snapshots).

| **Snapshot**            | **vCPU** | **Memory** | **Storage** | **GPU** | **Sandbox Class** |
| ----------------------- | -------- | ---------- | ----------- | ------- | ----------------- |
| **`daytona-small`**     | 1        | 1GiB       | 3GiB        |         | Container         |
| **`daytona-medium`**    | 2        | 4GiB       | 8GiB        |         | Container         |
| **`daytona-large`**     | 4        | 8GiB       | 10GiB       |         | Container         |
| **`daytona-gpu`**       | 1        | 1GiB       | 1GiB        | 1       | GPU               |
| **`daytona-vm-small`**  | 1        | 1GiB       | 3GiB        |         | Linux VM          |
| **`daytona-vm-medium`** | 2        | 4GiB       | 8GiB        |         | Linux VM          |
| **`daytona-vm-large`**  | 4        | 8GiB       | 10GiB       |         | Linux VM          |
| **`windows-small`**     | 1        | 4GiB       | 30GiB       |         | Windows           |
| **`windows-medium`**    | 2        | 8GiB       | 50GiB       |         | Windows           |
| **`windows-large`**     | 4        | 16GiB      | 50GiB       |         | Windows           |

1. Go to [Daytona Sandboxes ↗](https://app.daytona.io/dashboard/sandboxes)
2. Click <Button>Create Sandbox</Button>
3. Select a **`snapshot`**
4. Click <Button>Create</Button>

```python
from daytona import Daytona, CreateSandboxFromSnapshotParams

daytona = Daytona()
sandbox = daytona.create(
    CreateSandboxFromSnapshotParams(
        snapshot="daytona-small",
    )
)
```

### Resources

Create a sandbox with custom resources.

Sandboxes have **1 vCPU**, **1GB RAM**, and **3GiB disk** by default. Organizations get a maximum sandbox resource limit of **4 vCPUs**, **8GB RAM**, and **10GB disk**.

| **Resource** | **Unit** | **Default** | **Minimum** | **Maximum** |
| ------------ | -------- | ----------- | ----------- | ----------- |
| CPU          | vCPU     | **`1`**     | **`1`**     | **`4`**     |
| Memory       | GiB      | **`1`**     | **`1`**     | **`8`**     |
| Disk         | GiB      | **`3`**     | **`1`**     | **`10`**    |

1. Go to [Daytona Sandboxes ↗](https://app.daytona.io/dashboard/sandboxes)
2. Click <Button>Create Sandbox</Button>
3. Enter a base <Button>Image</Button> (e.g. **`ubuntu:22.04`**) as the source for the sandbox
4. Set <Button>Resources</Button> (**`cpu`**, **`memory`**, **`disk`**) to the values within your organization's limits
5. Click <Button>Create</Button>

```python
from daytona import Daytona, CreateSandboxFromImageParams, Image, Resources

daytona = Daytona()
sandbox = daytona.create(
    CreateSandboxFromImageParams(
        image="ubuntu:22.04",
        resources=Resources(cpu=2, memory=4, disk=8),
    )
)
```

<a id="multiple-runtime-support"></a>
### Languages

Create a sandbox with a specific language runtime.

Daytona sandboxes support **Python**, **TypeScript**, and **JavaScript** programming language runtimes for direct code execution inside the sandbox. The `language` parameter controls which programming language runtime is used for the sandbox. If omitted, it defaults to `python`.

- **`python`**
- **`typescript`**
- **`javascript`**

```python
from daytona import Daytona, CreateSandboxFromSnapshotParams

daytona = Daytona()

# Python runtime (default)
sandbox = daytona.create(CreateSandboxFromSnapshotParams(language="python"))
response = sandbox.process.code_run('print("Hello from Python")')
print(response.result)

# TypeScript runtime
sandbox = daytona.create(CreateSandboxFromSnapshotParams(language="typescript"))
response = sandbox.process.code_run('console.log("Hello from TypeScript")')
print(response.result)

# JavaScript runtime
sandbox = daytona.create(CreateSandboxFromSnapshotParams(language="javascript"))
response = sandbox.process.code_run('console.log("Hello from JavaScript")')
print(response.result)
```

### Environment variables

Create a sandbox with environment variables. Use [secrets](https://www.daytona.io/docs/en/secrets) for API keys, tokens, and passwords.

```python
from daytona import Daytona, CreateSandboxFromSnapshotParams

daytona = Daytona()
sandbox = daytona.create(CreateSandboxFromSnapshotParams(
    env_vars={"DEBUG": "true", "LOG_LEVEL": "info"},
))
```

### Regions

Create a sandbox in a specific [region](./regions.md).

| **Region**    | **Target** |
| ------------- | ---------- |
| United States | **`us`**   |
| Europe        | **`eu`**   |

1. Go to [Daytona Sandboxes ↗](https://app.daytona.io/dashboard/sandboxes)
2. Click <Button>Create Sandbox</Button>
3. Set <Button>Region</Button> to the target region you want to create the sandbox in
4. Click <Button>Create</Button>

```python
from daytona import Daytona, DaytonaConfig

daytona = Daytona(DaytonaConfig(target="us"))
sandbox = daytona.create()
```

## VM sandboxes

Daytona provides **VM sandboxes** for workloads that require a full virtual machine with a dedicated **Linux VM** or **Windows** operating system.

VM sandboxes are distinct from container sandboxes and support VM-only capabilities:

- [Fork sandboxes](#fork-sandboxes)
- [Pause and resume sandboxes](#pause--resume-sandboxes)
- [Create snapshot from sandbox](#create-snapshot-from-sandbox)
> **Note: Limitations**
> VM sandboxes can currently only be created from existing VM snapshots. Dynamic builds through the declarative builder are supported for container sandboxes only.

**Linux VM:**

**Create from snapshot:**

Create a Linux VM sandbox from a default snapshot.

1. Go to [Daytona Sandboxes ↗](https://app.daytona.io/dashboard/sandboxes)
2. Click <Button>Create Sandbox</Button>
3. Select a Linux VM snapshot:

    - **`daytona-vm-small`**
    - **`daytona-vm-medium`**
    - **`daytona-vm-large`**

4. Click <Button>Create</Button>

```python
from daytona import Daytona, CreateSandboxFromSnapshotParams

daytona = Daytona()
sandbox = daytona.create(CreateSandboxFromSnapshotParams(snapshot="daytona-vm-small"))
```

**Create from custom snapshot:**

Create a Linux VM sandbox from a custom snapshot.

1. Create a snapshot from a base **`image`**
2. Set sandbox class to **`LINUX_VM`**
3. Create a Linux VM sandbox from the snapshot

```python
from daytona import (
    Daytona,
    CreateSnapshotParams,
    CreateSandboxFromSnapshotParams,
    SandboxClass,
)

daytona = Daytona()

# 1. Create a VM snapshot (linux-vm class)
daytona.snapshot.create(
    CreateSnapshotParams(
        name="my-vm-snapshot",
        image="ubuntu:22.04",
        sandbox_class=SandboxClass.LINUX_VM,
    )
)

# 2. Create a VM sandbox from the snapshot
sandbox = daytona.create(CreateSandboxFromSnapshotParams(snapshot="my-vm-snapshot"))
```

**Windows:**

Create a Windows sandbox.

1. Go to [Daytona Sandboxes ↗](https://app.daytona.io/dashboard/sandboxes)
2. Click <Button>Create Sandbox</Button>
3. Select a Windows snapshot:

    - **`windows-small`**
    - **`windows-medium`**
    - **`windows-large`**

4. Click <Button>Create</Button>

```python
from daytona import Daytona, CreateSandboxFromSnapshotParams

daytona = Daytona()
sandbox = daytona.create(
    CreateSandboxFromSnapshotParams(
        snapshot="windows-small",
    )
)
```

## GPU sandboxes

Daytona provides **GPU sandboxes** for workloads that require NVIDIA GPU acceleration, such as model inference, fine-tuning, and CUDA-accelerated compute. GPU sandboxes are ephemeral and support up to **16 vCPUs**, **192GB RAM**, and **512GB disk**. Supported GPU types:

- **NVIDIA H100**
- **NVIDIA H200**
- **NVIDIA RTX Pro 6000**
- **NVIDIA RTX 4090**
- **NVIDIA RTX 5090**

GPU sandboxes are on-demand. See [spot GPU sandboxes](#spot-gpu-sandboxes) for preemptible GPU capacity.

> Due to possible events of temporary GPU scarcity, the target/region requested for GPU sandboxes is ignored by default. If you need access to a specific geographical location, contact us at support@daytona.io.

**Create from snapshot:**

Create a GPU sandbox from a default snapshot.

1. Go to [Daytona Sandboxes ↗](https://app.daytona.io/dashboard/sandboxes)
2. Click <Button>Create Sandbox</Button>
3. Select a **`daytona-gpu`** snapshot
4. Select **`ephemeral`** or set **`auto-delete interval`** to **`0`**
5. Click <Button>Create</Button>

```python
from daytona import Daytona, CreateSandboxFromSnapshotParams

daytona = Daytona()
sandbox = daytona.create(
    CreateSandboxFromSnapshotParams(
        snapshot="daytona-gpu",
        auto_delete_interval=0,
    ),
)
```

**Create with custom resources:**

Create a GPU sandbox with custom GPU resources: units and types.

1. Create a sandbox from an **`image`**
2. Set the **`auto-delete interval`** to **`0`** (ephemeral)
3. Set the **`GPU`** to the number of GPU units
4. Specify the **`GPU type`**(s):

    The GPU type field accepts a single value or an ordered list of preferred types.

    Daytona uses the first available type in the order you provide. This lets you fall back from a preferred GPU to an alternative when the first choice is not available.

    - **`H100`**
    - **`H200`**
    - **`RTX-PRO-6000`**
    - **`RTX-4090`**
    - **`RTX-5090`**

```python
from daytona import Daytona, CreateSandboxFromImageParams, Image, Resources, GpuType

daytona = Daytona()
sandbox = daytona.create(
    CreateSandboxFromImageParams(
        image=Image.debian_slim("3.12"),
        auto_delete_interval=0,
        resources=Resources(
            gpu=1,
            gpu_type=[GpuType.H100, GpuType.RTX_PRO_6000],
        ),
    )
)
```

### Spot GPU sandboxes

Spot GPU sandboxes are preemptible and run on GPU capacity that is not being used by reserved (on-demand) sandboxes. A spot GPU sandbox can be terminated at any time without notice when an on-demand GPU sandbox needs the capacity. Daytona does not send a preemption warning or a dedicated preemption webhook. Design workloads to tolerate immediate interruption.

When a spot GPU sandbox is destroyed, normal [sandbox lifecycle state](#sandbox-lifecycle) updates still apply. Daytona records when the preemption occurred with a `spotEvictedAt` timestamp to identify sandboxes destroyed by spot GPU preemption. Sandboxes destroyed by spot GPU preemption remain retrievable for 24 hours.

Spot GPU sandboxes do not count against the organization's GPU quota. Available GPU capacity is the only limit. If no spot GPU is available, create fails immediately.

**Create from snapshot:**

Create a spot GPU sandbox from a default `daytona-gpu` snapshot.

```python
from daytona import Daytona, CreateSandboxFromSnapshotParams

daytona = Daytona()
sandbox = daytona.create(
    CreateSandboxFromSnapshotParams(
        snapshot="daytona-gpu",
        auto_delete_interval=0,
        spot=True,
    ),
)
```

**Create with custom resources:**

Create a spot GPU sandbox with custom GPU resources: units and types.

1. Create a sandbox from an **`image`**
2. Set the **`auto-delete interval`** to **`0`** (ephemeral)
3. Set **`spot`** to **`true`**
4. Set the **`GPU`** to the number of GPU units
5. Specify the **`GPU type`**(s):

    The GPU type field accepts a single value or an ordered list of preferred types.

    Daytona uses the first available type in the order you provide. This lets you fall back from a preferred GPU to an alternative when the first choice is not available.

    - **`H100`**
    - **`H200`**
    - **`RTX-PRO-6000`**
    - **`RTX-4090`**
    - **`RTX-5090`**

```python
from daytona import Daytona, CreateSandboxFromImageParams, Image, Resources, GpuType

daytona = Daytona()
sandbox = daytona.create(
    CreateSandboxFromImageParams(
        image=Image.debian_slim("3.12"),
        auto_delete_interval=0,
        spot=True,
        resources=Resources(
            gpu=1,
            gpu_type=[GpuType.H100, GpuType.RTX_PRO_6000],
        ),
    )
)
```

## Ephemeral sandboxes

Create an ephemeral sandbox. Ephemeral sandboxes are automatically deleted when stopped.

1. Go to [Daytona Sandboxes ↗](https://app.daytona.io/dashboard/sandboxes)
2. Click <Button>Create Sandbox</Button>
3. Set <Button>Ephemeral</Button> or set the [auto-delete interval](#auto-delete-interval) to **`0`**
4. Click <Button>Create</Button>

```python
from daytona import Daytona, CreateSandboxFromSnapshotParams

daytona = Daytona()
params = CreateSandboxFromSnapshotParams(
    ephemeral=True,
    auto_stop_interval=5,
)
sandbox = daytona.create(params)
```

## Linked sandboxes

Create a linked sandbox. Linked sandboxes attach ephemeral child sandboxes to a parent. Daytona schedules each child on the same runner as the parent and joins them into a shared link network so the group can communicate over local connections.

- **Lifecycle**

  Linked sandboxes are always ephemeral and cannot be persisted or resumed after stop. The [auto-delete interval](#auto-delete-interval) must be exactly `0` on create; this is enforced, not a default. The [auto-stop interval](#auto-stop-interval) sets the idle period in minutes after which the child sandbox stops. Once stopped, linked children are auto-deleted. Deleting the parent deletes all of its linked children (cascade). One parent may have many linked children (1:N).

- **Networking**

  Linked sandboxes share an internal link network. Connections work in both directions: the parent can reach each child and each child can reach the parent. Every sandbox on the link network is registered under its sandbox name and ID as DNS aliases, so either works as the host. For example: `telnet LINKED_SANDBOX_ID 5555` from the parent reaches port `5555` on the linked child sandbox.

1. Create a parent sandbox
2. Create one or more child sandboxes that reference the parent's sandbox ID.

This records the relationship on the child sandbox as the linked sandbox ID. Omitting the linked sandbox parameter yields an unlinked sandbox.

```python
from daytona import CreateSandboxFromSnapshotParams, Daytona

daytona = Daytona()

parent = daytona.create()

child = daytona.create(
    CreateSandboxFromSnapshotParams(
        linked_sandbox=parent.id,
        ephemeral=True,
    )
)

# The link network registers each sandbox under its name as a DNS alias
response = child.process.exec(f"curl http://{parent.name}:3000/")
```

## Start sandboxes

Start a sandbox.

1. Go to [Daytona Sandboxes ↗](https://app.daytona.io/dashboard/sandboxes)
2. Click the start icon (**▶**) next to the sandbox you want to start

```python
sandbox.start()
```

## Get sandbox

Get a sandbox by ID or name.

```python
sandbox = daytona.get("my-sandbox-id-or-name")
```

## List sandboxes

List sandboxes.

```python
for sandbox in daytona.list():
    print(sandbox.id)
```

## Stop sandboxes

Stop a sandbox. The sandbox moves to the **stopped** state when shutdown completes. While a stop is in progress, the sandbox is in the **stopping** state and does not accept new requests.

**Container:**

Stopping terminates the running container. The filesystem is preserved, but memory state is not. Container sandboxes do not support pause; stop is the way to shut down a container sandbox when it is not in use.

1. Go to [Daytona Sandboxes ↗](https://app.daytona.io/dashboard/sandboxes)
2. Click the stop icon (**⏹**) next to the sandbox you want to stop

```python
sandbox.stop()
```

**Linux VM:**

Stopping shuts down the virtual machine while preserving the filesystem. Memory state is cleared. To preserve running process state without consuming CPU, use <u>[**pause / resume**](#pause--resume-sandboxes)</u>.

1. Go to [Daytona Sandboxes ↗](https://app.daytona.io/dashboard/sandboxes)
2. Click the stop icon (**⏹**) next to the sandbox you want to stop

```python
sandbox.stop()
```

**Windows:**

Stopping shuts down the virtual machine while preserving the filesystem. Memory state is cleared. To preserve running process state without consuming CPU, use <u>[**pause / resume**](#pause--resume-sandboxes)</u>.

1. Go to [Daytona Sandboxes ↗](https://app.daytona.io/dashboard/sandboxes)
2. Click the stop icon (**⏹**) next to the sandbox you want to stop

```python
sandbox.stop()
```
> **Note: Force stop**
> If you need a faster shutdown, use force stop (`force=true` / `--force`) to terminate the sandbox immediately. Force stop is ungraceful and should be used when quick termination is more important than process cleanup. Avoid force stop for normal shutdowns where the process should flush buffers, write final state, or run cleanup.

## Archive sandboxes

Archive a sandbox.

**Container:**

Archive moves a stopped sandbox's filesystem to object storage and frees disk quota.

1. Ensure the sandbox is **stopped**
2. **Archive** the sandbox
3. Wait for the sandbox to reach the **archived** state
4. **Start** the sandbox again when you need to use it

```python
sandbox.archive()
```

**Linux VM:**

Archive is not supported for Linux VM sandboxes. Stopping a Linux VM sandbox already offloads filesystem state and releases disk quota, so a separate archive step is not needed.

**Windows:**

Archive is not supported for Windows sandboxes. Stopping a Windows sandbox already offloads filesystem state and releases disk quota, so a separate archive step is not needed.

<a id="pause-sandboxes"></a>
## Pause / resume sandboxes

Pause and resume a sandbox.

**Container:**

Pause is not supported for container sandboxes. The filesystem can be preserved on stop, but memory state is not. Use <u>[**stop**](#stop-sandboxes)</u> to shut down a container sandbox when it is not in use.

**Linux VM:**

The filesystem and memory state are preserved, and CPU is no longer consumed.

1. Ensure the Linux VM sandbox is **started**
2. **Pause** the Linux VM sandbox
3. Wait for the Linux VM sandbox to reach the **paused** state
4. **Resume** (start) the Linux VM sandbox again when you need to resume it

```python
sandbox.pause()
```

**Windows:**

The filesystem and memory state are preserved, and CPU is no longer consumed.

1. Ensure the Windows sandbox is **started**
2. **Pause** the Windows sandbox
3. Wait for the Windows sandbox to reach the **paused** state
4. **Resume** (start) the Windows sandbox again when you need to resume it

```python
sandbox.pause()
```

## Recover sandboxes

Recover a sandbox.

1. Ensure the sandbox is in **error** state
2. Check that the sandbox is **recoverable**
3. Resolve any underlying issue that requires user intervention
4. **Recover** the sandbox and wait for it to be ready

```python
# Check if the sandbox is recoverable
if sandbox.recoverable:
    sandbox.recover()
```

```python
sandbox.recover()
```

## Resize sandboxes

Resizing updates the sandbox resource allocation (`cpu`, `memory`, and `disk`) for that sandbox. CPU and memory control compute capacity for running workloads, while disk controls persistent filesystem capacity.

On a running sandbox, you can increase CPU and memory without interruption. To decrease CPU or memory, or to increase disk capacity, stop the sandbox first. Disk size can only be increased and cannot be decreased.

1. Choose the new **CPU**, **memory**, and **disk** values within your organization's limits
2. Ensure the sandbox is **stopped** if you need to decrease CPU or memory, or increase disk
3. **Resize** the sandbox with the new resource values
4. **Start** the sandbox

```python
# Resize a started sandbox (CPU and memory can be increased)
sandbox.resize(Resources(cpu=2, memory=4))

# Resize a stopped sandbox (CPU and memory can change, disk can only increase)
sandbox.stop()
sandbox.resize(Resources(cpu=4, memory=8, disk=20))
sandbox.start()
```

To verify CPU and memory limits inside the sandbox after resizing, read `cgroup` values directly. Tools such as `nproc`, `free`, `top`, `htop`, `/proc/cpuinfo`, and `/proc/meminfo` read host-level values and do not reflect sandbox resource limits.

```bash
cat /sys/fs/cgroup/cpu.max      # "<quota> <period>" (cores = quota / period)
cat /sys/fs/cgroup/memory.max   # bytes
df -h /                         # disk
```

## Label sandboxes

Set sandbox labels.

1. Go to [Daytona Sandboxes ↗](https://app.daytona.io/dashboard/sandboxes)
2. Click <Button>Create Sandbox</Button>
3. Click <Button>Add Labels</Button>
4. Enter the labels in key-value pairs

```python
sandbox.set_labels({
    "team": "platform",
    "env": "staging",
})
```

## Delete sandboxes

Delete a sandbox.

By default `delete` is fire-and-forget: it returns as soon as the API accepts the deletion request, without waiting for the sandbox to be destroyed. Pass the `wait` flag to block until the sandbox reaches the destroyed state.

1. Go to [Daytona Sandboxes ↗](https://app.daytona.io/dashboard/sandboxes)
2. Click <Button>Delete</Button> next to the sandbox you want to delete.

```python
sandbox.delete()

# Block until the sandbox is destroyed
sandbox.delete(timeout=60, wait=True)
```

## Create snapshot from sandbox

Create a snapshot from a running or stopped sandbox.

**Container:**

Container sandboxes capture filesystem state only (**cold snapshot**):

| **Snapshot type** | **Include memory**    | **Snapshot contents** | **Required sandbox state** |
| ----------------- | --------------------- | --------------------- | -------------------------- |
| Cold              | **`false`** (default) | Filesystem only       | Stopped                    |



```python
sandbox._experimental_create_snapshot("my-snapshot")
```

**Linux VM:**

Linux VM sandboxes capture filesystem state only (**cold snapshot**) or filesystem and memory state (**hot snapshot**) through the `includeMemory` parameter:

| **Snapshot type** | **Include memory**    | **Snapshot contents** | **Required sandbox state** |
| ----------------- | --------------------- | --------------------- | -------------------------- |
| Cold              | **`false`** (default) | Filesystem only       | Stopped                    |
| Hot               | **`true`**            | Filesystem and memory | Started                    |



```python
# Cold snapshot (filesystem only, sandbox stopped)
sandbox._experimental_create_snapshot("my-snapshot")

# Hot snapshot (filesystem and memory, sandbox running)
sandbox._experimental_create_snapshot("my-vm-snapshot", include_memory=True)
```

**Windows:**

Windows sandboxes capture filesystem state only (**cold snapshot**) or filesystem and memory state (**hot snapshot**) through the `includeMemory` parameter:

| **Snapshot type** | **Include memory**    | **Snapshot contents** | **Required sandbox state** |
| ----------------- | --------------------- | --------------------- | -------------------------- |
| Cold              | **`false`** (default) | Filesystem only       | Stopped                    |
| Hot               | **`true`**            | Filesystem and memory | Started                    |



```python
# Cold snapshot (filesystem only, sandbox stopped)
sandbox._experimental_create_snapshot("my-snapshot")

# Hot snapshot (filesystem and memory, sandbox running)
sandbox._experimental_create_snapshot("my-vm-snapshot", include_memory=True)
```

## Fork sandboxes

Fork a sandbox.

**Container:**

Forking is not supported for container sandboxes. Use <u>[**create snapshot from sandbox**](#create-snapshot-from-sandbox)</u> to capture filesystem state, then create a new sandbox from that snapshot.

**Linux VM:**

Forking creates a duplicate of a Linux VM sandbox's filesystem and memory state in a new sandbox. The forked sandbox is fully independent: it can be started, stopped, and deleted without affecting the original.

Daytona tracks the parent-child relationship in a fork tree, so you can trace a fork's lineage back to the sandbox it was created from. You can fork a fork to build branches. The parent sandbox cannot be deleted while it has active fork children.

1. Go to [Daytona Sandboxes ↗](https://app.daytona.io/dashboard/sandboxes)
2. Click the three-dot menu (**⋮**) next to the started Linux VM sandbox you want to fork
3. Select <Button>Fork</Button>

```python
# Fork sandbox through the Sandbox instance
forked = sandbox.fork(name="my-forked-sandbox")
```

**Windows:**

Forking creates a duplicate of a Windows sandbox's filesystem and memory state in a new sandbox. The forked sandbox is fully independent: it can be started, stopped, and deleted without affecting the original.

Daytona tracks the parent-child relationship in a fork tree, so you can trace a fork's lineage back to the sandbox it was created from. You can fork a fork to build branches. The parent sandbox cannot be deleted while it has active fork children.

1. Go to [Daytona Sandboxes ↗](https://app.daytona.io/dashboard/sandboxes)
2. Click the three-dot menu (**⋮**) next to the started Windows sandbox you want to fork
3. Select <Button>Fork</Button>

```python
# Fork sandbox through the Sandbox instance
forked = sandbox.fork(name="my-forked-sandbox")
```

## Sandbox lifecycle

Every sandbox moves through a lifecycle. A sandbox can have several different states. Each state reflects the status of your sandbox. A sandbox transitions between states in response to user actions, or through [automated lifecycle management](#automated-lifecycle-management) based on inactivity intervals. Available lifecycle features depend on the sandbox class.

| **Lifecycle feature**                             | **Container** | **Linux VM** | **Windows** | **GPU** |
| ------------------------------------------------- | ------------- | ------------ | ----------- | ------- |
| Start sandboxes                                   | ✓             | ✓            | ✓           | ✓       |
| Stop sandboxes                                    | ✓             | ✓            | ✓           | ✓       |
| Pause / resume sandboxes                          | ✗             | ✓            | ✓           | ✗       |
| Archive sandboxes                                 | ✓             | ✗            | ✗           | ✗       |
| Fork sandboxes                                    | ✗             | ✓            | ✓           | ✗       |
| Snapshot from sandbox <br />(filesystem only)     | ✓             | ✓            | ✓           | ✓       |
| Snapshot from sandbox <br />(filesystem + memory) | ✗             | ✓            | ✓           | ✗       |

The diagram demonstrates the states and possible transitions between them.


**Sandbox states**


| **State**         | **Description**                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------- |
| Creating          | The sandbox is provisioning and will be ready to use.                                       |
| Pulling Snapshot  | The sandbox is pulling a [**snapshot**](./snapshots.md) to provide a base environment.  |
| Building Snapshot | The sandbox is building a [**snapshot**](./snapshots.md) to provide a base environment. |
| Pending Build     | The sandbox build is pending and will start shortly.                                        |
| Build Failed      | The sandbox build failed and needs to be retried.                                           |
| Starting          | The sandbox is starting and will be ready to use.                                           |
| Started           | The sandbox has started and is ready to use.                                                |
| Stopping          | The sandbox is stopping and will no longer accept requests.                                 |
| Stopped           | The sandbox has stopped and is no longer running. Container sandboxes keep their filesystem on the runner. VM sandboxes offload filesystem state to nearby storage. |
| Pausing           | The VM sandbox is pausing while its filesystem and memory state are preserved.              |
| Paused            | The VM sandbox is paused with filesystem and memory state preserved. State is offloaded to nearby storage. |
| Resuming          | The VM sandbox is resuming from a paused state and will be ready to use.                    |
| Archiving         | The container sandbox filesystem is being moved to object storage.                          |
| Archived          | The container sandbox filesystem is stored in object storage.                               |
| Restoring         | The sandbox is being restored and will be ready to use shortly.                             |
| Resizing          | The sandbox is being resized to a new set of resources.                                     |
| Snapshotting      | The sandbox is creating a [**snapshot**](./snapshots.md) of its filesystem and memory.  |
| Forking           | The sandbox is being forked into a new independent sandbox.                                 |
| Deleting          | The sandbox is deleting and will be removed.                                                |
| Deleted           | The sandbox has been deleted and no longer exists.                                          |
| Error             | The sandbox is in an error state and needs to be recovered.                                 |
| Unknown           | The default sandbox state before it is created.                                             |


##### State transitions

A sandbox can transition between states in response to various actions. The following table lists the initial state, target state, and trigger for the transition.

**State transitions**


| **Initial state** | **Target state**  | **Trigger**                                                                       |
| ----------------- | ----------------- | --------------------------------------------------------------------------------- |
| Unknown           | Pulling Snapshot  | The base snapshot is being pulled to provide the sandbox environment.             |
| Unknown           | Building Snapshot | The sandbox uses a declarative image build, which begins building.                |
| Pending Build     | Building Snapshot | The queued image build starts.                                                    |
| Building Snapshot | Build Failed      | The image build fails or times out.                                               |
| Pulling Snapshot  | Creating          | The snapshot is available and the sandbox container is created.                   |
| Building Snapshot | Creating          | The snapshot finishes building and the sandbox container is created.              |
| Creating          | Started           | The sandbox container finishes initializing and is running.                       |
| Stopped           | Starting          | A start is requested and the sandbox boots.                                       |
| Stopped           | Restoring         | A start is requested and the sandbox is restored from a backup.                   |
| Archived          | Restoring         | A start is requested and the archived filesystem is restored from object storage. |
| Restoring         | Started           | The restore completes and the sandbox is running.                                 |
| Starting          | Started           | The sandbox is running and ready to accept requests.                              |
| Started           | Stopping          | A stop is requested, or the auto-stop interval is exceeded.                       |
| Stopping          | Stopped           | The sandbox process exits and its memory state is cleared.                        |
| Started           | Pausing           | A pause is requested, or the auto-pause interval is exceeded.                     |
| Pausing           | Paused            | The filesystem and memory state are preserved.                                    |
| Paused            | Resuming          | A start is requested on a paused sandbox.                                         |
| Paused            | Stopping          | A stop is requested on a paused sandbox.                                          |
| Resuming          | Started           | The sandbox resumes from memory and is running.                                   |
| Stopped           | Archiving         | An archive is requested, or the auto-archive interval is exceeded.                |
| Archiving         | Archived          | The backup completes and the filesystem is moved to object storage.               |
| Started           | Resizing          | CPU or memory is increased on a running sandbox.                                  |
| Stopped           | Resizing          | Resources are changed on a stopped sandbox.                                       |
| Resizing          | Started           | The running sandbox returns to service after resizing.                            |
| Resizing          | Stopped           | The stopped sandbox completes resizing.                                           |
| Started           | Snapshotting      | A snapshot of the filesystem and memory is created.                               |
| Stopped           | Snapshotting      | A snapshot of the filesystem is created.                                          |
| Snapshotting      | Started           | The snapshot completes and the sandbox returns to service.                        |
| Snapshotting      | Stopped           | The snapshot completes and the sandbox remains stopped.                           |
| Started           | Forking           | The sandbox is forked into a new independent sandbox.                             |
| Forking           | Started           | The fork completes and the sandbox returns to service.                            |
| Started           | Deleting          | A delete is requested, or the auto-delete interval is exceeded.                   |
| Stopped           | Deleting          | A delete is requested.                                                            |
| Archived          | Deleted           | An archived sandbox is deleted directly without being restored.                   |
| Deleting          | Deleted           | The sandbox is removed and its resources are released.                            |
| Started           | Error             | An operation fails or times out.                                                  |
| Error             | Restoring         | A recover is requested for a recoverable error and the sandbox is restored.       |
| Error             | Archiving         | An errored sandbox with a completed backup is archived to preserve its state.     |


## Automated lifecycle management

Sandboxes can be managed automatically based on user-defined deadlines. Inactivity and stopped-time intervals stop, pause, archive, or delete a sandbox when it is idle. Wall-clock TTL destroys a sandbox after a fixed deadline regardless of state.

- **[Auto-stop interval](#auto-stop-interval)**: stop a sandbox after a specified period of inactivity
- **[Auto-pause interval](#auto-pause-interval)**: pause a VM sandbox after a specified period of inactivity
- **[Auto-archive interval](#auto-archive-interval)**: archive a sandbox after a specified period of inactivity
- **[Auto-delete interval](#auto-delete-interval)**: delete a sandbox after a specified period of inactivity
- **[Wall-clock TTL](#wall-clock-ttl)**: destroy a sandbox after a fixed wall-clock deadline, regardless of state
- **[Update sandbox last activity](#update-sandbox-last-activity)**: signal activity to reset the inactivity timer
- **[Running indefinitely](#running-indefinitely)**: run a sandbox indefinitely

### Auto-stop interval

The auto-stop interval sets the amount of time after which a running sandbox is automatically stopped. The auto-stop triggers even if there are internal processes running in the sandbox.

1. Go to [Daytona Sandboxes ↗](https://app.daytona.io/dashboard/sandboxes)
2. Click <Button>Create Sandbox</Button>
3. Set **`auto-stop`** interval to the desired value in minutes
    - **`0`**: disables the auto-stop functionality, allowing the sandbox to run indefinitely
    - if not set, the default interval of 15 minutes is used
4. Click <Button>Create</Button>

```python
sandbox = daytona.create(CreateSandboxFromSnapshotParams(
    snapshot="my-snapshot",
    # Disables the auto-stop feature - default is 15 minutes
    auto_stop_interval=0,
))
```

The system differentiates between "internal processes" and "active user interaction". Merely having a script or background task running is not sufficient to keep the sandbox alive.

##### What resets the timer

The inactivity timer resets only for specific external interactions:

- Updates to [sandbox lifecycle states](#sandbox-lifecycle)
- Network requests through [sandbox previews](./preview.md)
- Active [SSH connections](./ssh-access.md)
- API requests to the [Daytona Toolbox SDK](../api/README.md#daytona-toolbox)

##### What does not reset the timer

The following do not reset the timer:

- SDK requests that are not toolbox actions
- Background scripts (e.g., `npm run dev` run as a fire-and-forget command)
- Long-running tasks without external interaction
- Processes that don't involve active monitoring

If you run a long-running task like LLM inference that takes more than 15 minutes to complete without any external interaction, the sandbox may auto-stop mid-process because the process itself doesn't count as "activity", therefore the timer is not reset.

### Auto-pause interval

The auto-pause interval sets the amount of time after which an idle VM sandbox is automatically [paused](#pause--resume-sandboxes). Auto-pause applies only to [VM sandboxes](#vm-sandboxes) and is mutually exclusive with the [auto-stop interval](#auto-stop-interval): at most one of the two intervals may be non-zero. Ephemeral sandboxes cannot have auto-pause enabled.

The interval is set in minutes:

- **`0`**: disables the auto-pause functionality
- if neither auto-pause nor auto-stop is set, non-ephemeral sandbox classes that support pausing default to an auto-pause interval of 60 minutes with auto-stop disabled

The sandbox pauses after no new events occur for the specified interval. Events include sandbox state changes and interactions with the sandbox through the SDK. Interactions through [sandbox previews](./preview.md) do not reset the timer.

**Container:**

Auto-pause is not supported for container sandboxes. Use <u>[**auto-stop**](#auto-stop-interval)</u> to stop a container sandbox after a period of inactivity.

**Linux VM:**

1. Go to [Daytona Sandboxes ↗](https://app.daytona.io/dashboard/sandboxes)
2. Click <Button>Create Sandbox</Button>
3. Select a Linux VM snapshot
4. Set **`auto-pause`** interval to the desired value in minutes
    - **`0`**: disables the auto-pause functionality
    - if neither auto-pause nor auto-stop is set, the default interval of 60 minutes is used with auto-stop disabled
5. Click <Button>Create</Button>

```python
sandbox = daytona.create(CreateSandboxFromSnapshotParams(
    snapshot="daytona-vm-small",
    # Auto-pause after 1 hour of inactivity
    auto_pause_interval=60,
))

# Update the auto-pause interval on an existing sandbox
sandbox.set_auto_pause_interval(60)

# Disable auto-pause
sandbox.set_auto_pause_interval(0)
```

**Windows:**

1. Go to [Daytona Sandboxes ↗](https://app.daytona.io/dashboard/sandboxes)
2. Click <Button>Create Sandbox</Button>
3. Select a Windows snapshot
4. Set **`auto-pause`** interval to the desired value in minutes
    - **`0`**: disables the auto-pause functionality
    - if neither auto-pause nor auto-stop is set, the default interval of 60 minutes is used with auto-stop disabled
5. Click <Button>Create</Button>

```python
sandbox = daytona.create(CreateSandboxFromSnapshotParams(
    snapshot="windows-small",
    # Auto-pause after 1 hour of inactivity
    auto_pause_interval=60,
))

# Update the auto-pause interval on an existing sandbox
sandbox.set_auto_pause_interval(60)

# Disable auto-pause
sandbox.set_auto_pause_interval(0)
```

**GPU:**

Auto-pause is not supported for GPU sandboxes. GPU sandboxes are ephemeral and cannot have auto-pause enabled.

### Auto-archive interval

The auto-archive interval sets the amount of time after which a continuously stopped sandbox is automatically archived. Auto-archive applies only to container sandboxes. VM sandboxes are excluded.

1. Go to [Daytona Sandboxes ↗](https://app.daytona.io/dashboard/sandboxes)
2. Click <Button>Create Sandbox</Button>
3. Set **`auto-archive`** interval to the desired value in minutes
    - **`0`**: the maximum interval of 30 days is used
    - if not set, the default interval of 7 days is used
4. Click <Button>Create</Button>

```python
sandbox = daytona.create(CreateSandboxFromSnapshotParams(
    snapshot="my-snapshot",
    # Auto-archive after a sandbox has been stopped for 1 hour
    auto_archive_interval=60,
))
```

### Auto-delete interval

The auto-delete interval sets the amount of time after which a continuously stopped sandbox is automatically deleted.

1. Go to [Daytona Sandboxes ↗](https://app.daytona.io/dashboard/sandboxes)
2. Click <Button>Create Sandbox</Button>
3. Set **`auto-delete`** to the desired value in minutes
    - `-1`: disables the auto-delete functionality
    - `0`: the sandbox is deleted immediately after it is stopped
    - if not set, the sandbox is not deleted automatically
4. Click <Button>Create</Button>

```python
sandbox = daytona.create(CreateSandboxFromSnapshotParams(
    snapshot="my-snapshot",
    # Auto-delete after a sandbox has been stopped for 1 hour
    auto_delete_interval=60,
))

# Delete the sandbox immediately after it has been stopped
sandbox.set_auto_delete_interval(0)

# Disable auto-deletion
sandbox.set_auto_delete_interval(-1)
```

### Wall-clock TTL

The wall-clock TTL (time-to-live) sets a hard upper bound on how long a sandbox may exist. Unlike the [auto-delete interval](#auto-delete-interval), which counts time only while the sandbox is stopped, TTL runs as wall-clock time from creation (or from the moment you last set it) and destroys the sandbox in any state: started, stopped, paused, or archived.

Set `ttl_minutes` when creating a sandbox, or update it later. The value is in minutes:

- **`0`**: disables the TTL
- if not set, the sandbox has no TTL deadline

Calling `set_ttl` after creation resets the deadline from the current moment. Use wall-clock TTL for agent sessions, CI jobs, and any sandbox that must not outlive a fixed deadline.

```python
sandbox = daytona.create(CreateSandboxFromSnapshotParams(
    snapshot="my-snapshot",
    # Destroy the sandbox 2 hours after creation, regardless of state
    ttl_minutes=120,
))

# Reset the deadline to 1 hour from now
sandbox.set_ttl(60)

# Disable the TTL
sandbox.set_ttl(0)
```

### Update sandbox last activity

Update a sandbox's last activity timestamp.

This updates the sandbox's recorded activity time without changing its runtime state. It is useful when your workflow is driven by external systems or background orchestration that may not reset inactivity tracking.

```python
sandbox.refresh_activity()
```

### Running indefinitely

Run sandboxes indefinitely.

By default, Daytona sandboxes auto-stop after 15 minutes of inactivity. To keep a sandbox running without interruption from inactivity, set the auto-stop interval to `0` when creating a new sandbox. Disabling auto-stop does not disable [wall-clock TTL](#wall-clock-ttl): if `ttl_minutes` is set, the sandbox is still destroyed when that deadline elapses.

1. Go to [Daytona Sandboxes ↗](https://app.daytona.io/dashboard/sandboxes)
2. Click <Button>Create Sandbox</Button>
3. Set **`auto-stop`** to **`0`**
4. Click <Button>Create</Button>

```python
sandbox = daytona.create(CreateSandboxFromSnapshotParams(
    snapshot="my_awesome_snapshot",
    # Disables the auto-stop feature - default is 15 minutes
    auto_stop_interval=0,
))
```
