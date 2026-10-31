# 安装说明（给朋友看的简版）

## 前提

- 已装 **DeepSeek Harness 桌面版**，且模型接的是 `qwen-token-plan`（阿里云百炼）；
- 有一对**阿里云 AccessKey**（免费，RAM 子账号 + `AliyunBSSReadOnlyAccess` 只读权限最安全）。

## 三步装好

**第 1 步：把文件放进插件目录**

插件目录固定在 `~/.dsh/profiles/desktop/node_modules/`，Windows 上就是
`C:\Users\<你>\.dsh\profiles\desktop\node_modules\`。

- 有了本仓库：`git clone` 到上面这个目录下，目录名 `dsh-deepseek-usage-qwen`；
- 或者把压缩包解压到那里，同样叫 `dsh-deepseek-usage-qwen`。

**第 2 步：让 DSH 加载它**

编辑 `~/.dsh/profiles/desktop/package.json`：

```jsonc
{
  "dependencies": {
    // 加这一行（和其他依赖并列）
    "dsh-deepseek-usage-qwen": "file:node_modules/dsh-deepseek-usage-qwen"
  },
  "dsh": {
    "profile": {
      "bundles": [
        // …原来的其他 bundle 保持不动，把原版去掉、加上这一行
        "dsh-deepseek-usage-qwen"
      ]
    }
  }
}
```

> 如果你原来装了原版 `@dougen/dsh-deepseek-usage`，**从 bundles 里删掉它**（两者路由冲突，只能留一个）。

**第 3 步：重启 DSH**

完全退出（托盘图标也要退出）再打开。侧边栏底部会出现用量卡片。

## 填 AccessKey

设置 → 插件 → 找到 **dsh-deepseek-usage-qwen** → 详情页底部
「阿里云 AccessKey（查代金券余额）」→ 填 AccessKey ID 和 Secret → 保存。

保存后会立刻告诉你结果：成功显示 `已保存 · ¥金额`，失败会写原因（Key 不存在 / Secret 不对 / 缺只读权限）。

## 卸载

从 `bundles` 里删掉 `dsh-deepseek-usage-qwen`，删掉对应目录，重启 DSH。
想恢复原版就把 `@dougen/dsh-deepseek-usage` 加回 bundles。
