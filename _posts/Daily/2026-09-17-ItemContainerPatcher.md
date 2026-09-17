---
title: ItemContainerPatcher
key: icp
tags: ["Daily"]
aside:
  toc: true
---

僵尸毁灭工程ItemContainer修复补丁 <!--more-->

## 前言：为什么我们连“修车”都要自己造轮子？

在《僵尸毁灭工程》（Project Zomboid，简称PZ）的模组开发圈子里，我观察到：应用层内容很繁荣，物品、UI、玩法都有人做，但愿意碰底层引擎问题的人相对少。底层修复的经验和踩坑记录往往比较分散，新手入门时，常常只能反编译别人的模组或补丁，或者对着 `projectzomboid.jar` 发呆。尤其是进入 Build 42 版本后，很多老经验失效，信息差带来的阵痛更加明显。

前段时间，为了修复游戏中一个极其隐蔽的底层崩溃问题，我不得不将目光从Lua脚本转向了Java字节码。这就是 ItemContainerPatcher 诞生的背景。

我知道在黑暗中摸索的滋味有多难受。所以，我选择将它的全部技术细节、设计思路和源码完全公开。

GitHub仓库地址：[ItemContainerPatcher](https://github.com/Zucker-jex/ItemContainerPatcher)

---

## **警告**

本补丁未经完整测试，请谨慎使用。这是非官方补丁，与 Project Zomboid 官方无关。强烈建议提前备份，请勿对无法恢复的 jar 使用本工具。

---

## 项目定位：引擎修复

ItemContainerPatcher 是一个用于 Project Zomboid 的字节码补丁工具。它通过向指定方法注入线程局部的递归深度守卫，修复 `zombie.inventory.ItemContainer` 中可能出现的无限递归问题。

### 问题背景

ItemContainer 可能通过 `getCharacter()`、`isInCharacterInventory(IsoGameCharacter)` 等方法进入递归调用。在某些异常的物品栏/容器状态下，这可能造成无限递归、栈溢出（StackOverflowError）或服务器不稳定。

### 解决方案

该补丁使用 ASM 直接修改 `projectzomboid.jar` 中的 `zombie/inventory/ItemContainer.class`。

它会注入：

- 静态字段 `ThreadLocal<Integer> depthGuard`。
- 静态辅助方法 `enterDepthGuard()Z`。
- 静态辅助方法 `exitDepthGuard()V`。

在以下方法的进入点、每一个 return 之前，以及异常路径加入深度守卫：

- `getCharacter()Lzombie/characters/IsoGameCharacter;`
- `isInCharacterInventory(Lzombie/characters/IsoGameCharacter;)Z`

守卫允许的最大递归深度为 `MAX_DEPTH = 64`。超过限制时，被修补的方法会返回安全默认值，而不是继续递归：

- 返回对象的方法返回 null。
- 返回布尔值的方法返回 false。

---

## 环境要求与编译

### 环境要求

- Java 9 或更高版本（使用 `InputStream.readAllBytes()` 与 `InputStream.transferTo()`）。
- ASM 9.10.1 库：
  - `asm-9.10.1.jar`
  - `asm-commons-9.10.1.jar`
  - `asm-tree-9.10.1.jar`

Maven 依赖：

```xml
<dependency>
    <groupId>org.ow2.asm</groupId>
    <artifactId>asm</artifactId>
    <version>9.10.1</version>
</dependency>
<dependency>
    <groupId>org.ow2.asm</groupId>
    <artifactId>asm-commons</artifactId>
    <version>9.10.1</version>
</dependency>
<dependency>
    <groupId>org.ow2.asm</groupId>
    <artifactId>asm-tree</artifactId>
    <version>9.10.1</version>
</dependency>
```

（注：ASM 9.7+ 亦可工作，只需三个模块版本一致。）

### 编译命令

Windows：

```bash
javac -cp "asm-9.10.1.jar;asm-commons-9.10.1.jar;asm-tree-9.10.1.jar" ItemContainerPatcher.java
```

Linux/macOS：

```bash
javac -cp "asm-9.10.1.jar:asm-commons-9.10.1.jar:asm-tree-9.10.1.jar" ItemContainerPatcher.java
```

---

## 使用方法与安全机制

### 运行命令

Windows：

```bash
java -cp ".;asm-9.10.1.jar;asm-commons-9.10.1.jar;asm-tree-9.10.1.jar" ItemContainerPatcher [projectzomboid.jar 路径]
```

Linux/macOS：

```bash
java -cp ".:asm-9.10.1.jar:asm-commons-9.10.1.jar:asm-tree-9.10.1.jar" ItemContainerPatcher [projectzomboid.jar 路径]
```

如果没有提供路径，程序会使用当前目录下的 `projectzomboid.jar`。

### 自动备份机制

补丁程序会自动创建带时间戳的备份，与原 jar 同目录：
`projectzomboid.jar.20260914-135023.bak`

每次运行都会生成新的备份文件，不会覆盖旧的备份。

---

## 工作原理

1. 打开目标 jar，读取 `zombie/inventory/ItemContainer.class`。
2. 如果缺少静态字段 `ThreadLocal<Integer> depthGuard`，则添加它。
3. 注入 `enterDepthGuard()`：
   - 懒初始化 `depthGuard`。
   - 读取当前线程的递归深度。
   - 如果深度大于或等于 64，返回 true。
   - 否则增加深度并返回 false。
4. 注入 `exitDepthGuard()`：
   - 安全检查 null。
   - 仅当深度大于 0 时递减。
5. 以指令级别手工重写 `getCharacter()` 与 `isInCharacterInventory(...)`：
   - 在方法入口前置守卫检查与安全默认返回。
   - 在每一个 IRETURN / ARETURN / RETURN 之前插入 `exitDepthGuard()`。
   - 将原方法体包进 `try { ... } catch (Throwable t) { exitDepthGuard(); throw t; }`，保证异常路径也能还原深度。
   - 通过 Label 重映射保留原有的 try-catch 块。
6. 使用临时文件 + 原子移动策略将修改后的 class 写回 jar，避免 Windows 文件锁问题。
7. 回读写入的条目并与源字节做 `Arrays.equals` 比对校验。

---

## 思路来源与分析致谢

本补丁的核心诊断思路来自以下 Project Zomboid 故障报告：

[[42.20.4] [MP] Container cycles cause unbounded recursion in ItemContainer.getCharacter() — StackOverflowError kills the dedicated server main loop (13-minute silent freeze)](https://theindiestone.com/forums/topic/100891-42204-mp-container-cycles-cause-unbounded-recursion-in-itemcontainergetcharacter-stackoverflowerror-kills-the-dedicated-server-main-loop-13-minute-silent-freeze/)

该报告中对问题根因的分析直接决定了本补丁的设计方向：

1. 无界自递归，无循环检测。反编译后 `ItemContainer.getCharacter()`（第 3250–3256 行）沿着 `container -> containingItem -> containingItem.getContainer() -> getCharacter()` 递归下探，既没有 visited 集合，也没有深度计数器。`isInCharacterInventory(IsoGameCharacter)`（第 342–358 行，自递归在第 352 行）存在完全相同的结构。
2. 插入时不做循环拒绝。`ItemContainer.AddItem(InventoryItem)`（第 458–495 行）只拒绝重复的物品 ID，随后无条件执行 `item.container = this; this.items.add(item)`，完全不检查 this 是否已经处于 item 的祖先链之中。
3. 引擎已有的祖先检查深度不够。`TransactionManager.chainContainsContainingItem(ItemContainer, int)` 内部只循环 `for (int i = 0; i < 2; i++)`，仅向上检查两层，且为 private，AddItem 无法调用。
4. 真实影响。2026 年 8 月 13 日，一台约 60 名玩家在线的专用服务器主循环被 StackOverflowError 杀死，1024 帧可见堆栈全部是 `ItemContainer.getCharacter`。帧计数器冻结在 `f:54247` 长达 13 分钟，最终只能通过 SIGKILL + 看门狗重启恢复，期间所有玩家操作被静默丢弃。
5. 报告提出的修复方案与本补丁完全一致。报告者建议“给 `getCharacter()` 和 `isInCharacterInventory()` 加上 visited 集合或深度上限（64 远超任何合法嵌套深度），达到上限时返回 null / false”，并说明其“用实验性服务端热修复（ASM 字节码补丁）在深度 64 处截断两条递归链，验证了诊断”。

本补丁正是采用该深度上限方案，通过 ASM 将线程局部的 `ThreadLocal<Integer>` 守卫注入这两个方法来实现。

---

## 注意事项与恢复方法

### 注意事项

- 请始终保留原始 jar 的备份。
- 应用补丁后请重启服务器。
- 此工具会修改字节码，请仅用于目标版本的 `projectzomboid.jar`。
- 如果找不到目标类或目标方法，补丁程序会报错并退出。

### 恢复方法

列出最近的备份：

```cmd
dir /b /o-d projectzomboid.jar.*.bak
```

复制最近的备份覆盖当前 jar（时间戳按实际情况修改）：

```cmd
copy projectzomboid.jar.20260914-135023.bak projectzomboid.jar
```

Linux/macOS：

```bash
ls -t projectzomboid.jar.*.bak | head -n1 | xargs -I{} cp {} projectzomboid.jar
```

---

## 源码设计

在工程实现上，这个补丁程序并没有采用“黑魔法”，而是遵循了严谨的生产级规范：

- URLClassLoader 隔离：配合 `COMPUTE_FRAMES`，重写了 `getCommonSuperClass` 方法，确保在计算栈帧时能正确加载游戏 jar 中的类，并针对重复的异常做了去重日志。
- 幂等设计：多次运行补丁不会重复注入，已经修补过的方法和字段会自动跳过。
- 极致的文件安全：通过写入临时 Jar 文件并在流完全关闭后原子替换（`Files.move`），较好规避了 Windows 下的文件锁问题。写入前生成带时间戳的备份，写入后执行严格的字节比对校验。

---

## 致社区：让踩坑经验流动起来

如果没有前人在网络角落留下的零星片段，没有官方 Discord 里偶尔闪现的讨论，我不可能在一个晚上推进这么多。知识只有在流通中才有价值。

国内 PZ 圈需要更系统的开发资料。如果代码和经验长期留在各自手里，后来者就会重复踩坑，门槛也会被抬高。我写这篇文章并完全开源 ItemContainerPatcher，就是想先公开一份，做一块铺路石。

如果你对底层修复或模组开发感兴趣，推荐阅读我的 [Project Zomboid Build 42 模组开发知识库（实战修订版）](https://blog.zuckertech.cn/2026/09/16/pzmod.html)。

如果你也受够硬啃源码，愿意为社区做点什么，欢迎来 GitHub 提 Issue，或者分享自己的踩坑经验。别怕代码不够好，也别怕出错。公开出来，它就会成为后来者的路标。

项目地址：[ItemContainerPatcher](https://github.com/Zucker-jex/ItemContainerPatcher)

一起把 PZ 的 Mod 开发环境变得更好。

---

相关阅读与链接：

- [Project Zomboid Build 42 模组开发知识库（实战修订版）](https://blog.zuckertech.cn/2026/09/16/pzmod.html)
- [ItemContainerPatcher GitHub仓库](https://github.com/Zucker-jex/ItemContainerPatcher)