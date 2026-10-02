# BREACHLINE

原创网页战术 FPS 原型，支持单人拆弹训练，以及同一局域网内最多 10 名玩家参加 5v5 混编竞技拆弹：

- 128×144 米 K-7 工业园：A 开放反应堆场、B 三入口装卸大厅、中路设备区、锅炉连廊与南北轮转路线；地面面积为原 80×100 版本的 2.304 倍；PBR 材质和开放式日光场景，WebGPU 优先并自动回退 WebGL2
- 第一人称移动、跳跃、蹲下、冲刺、鼠标锁定与自动暂停
- 第一人称三维枪械和每手 16 骨 GPU 蒙皮战术手套：PX-9、VX-7、RIFT-6、Needle .50 使用本地 Blender 制作的网格，ARC-12 与 BR-4 使用 CC0 网格与材质；枪口火焰/短烟/局部照明、枪机后坐、接触式分阶段弹匣换弹和切枪动画
- 数据驱动的 6 类武器目录，主副武器独立保存弹药并可用 `1` / `2` 切换
- A/B 炸弹点、C4 携带/掉落/拾取、按住 `E` 安放或拆除、拆弹工具组与 40 秒引爆倒计时
- 15 秒购买、115 秒回合、12 回合换边、先取得 13 胜；超时、歼灭、拆除和爆炸分别判胜
- 手枪局限制、胜负奖金、连败档位、击杀及目标奖励、购买与退款规则
- Bot 的有限视线、听觉、反应延迟、短时追踪最后已知位置、横移接敌和可见的开火反馈；被掩体挡住的敌人不会被透视锁定
- 单人训练中 Bot 会进攻安放或防守回拆；联机服务器统一驱动双方 Bot；本地 Bot 与远端玩家共用 18 骨全身 GPU 蒙皮操作员，脚掌使用世界锚点与两骨 IK 保持接地，支持蹲起、随速度平滑起停的程序步态、稳定站姿、瞄准和短促开火后坐
- 购买菜单、小地图、攻守与存活人数、C4 进度、实时比分和结果页
- Recast 导航网格与战术点回退路径，Bot 卡住 2 秒后自动恢复
- 死亡掉枪、`E` 拾取、`G` 丢枪、`Shift+G` 丢 C4，弹匣/备弹状态守恒与回合末清理
- Bot 小队共享钱包、手枪局限制、混合买枪规划和单次团队奖励
- 五位房间码创建/加入、ALPHA/BRAVO 自动平衡、远端玩家插值显示与掉线自动重连
- 两队各五人，由玩家与 Bot 混编；Bot 自动补位，友伤关闭
- WebSocket 权威服务器统一裁定移动、射击、墙体遮挡、经济、C4 安放拆除、回合和比赛结果
- 多人死亡掉枪、竞争拾取和主动丢弃，唯一实体 ID 防止重复获得
- 15 秒断线状态保留、协议版本校验、消息限频与全员再战投票
- Vitest 规则测试、TypeScript 严格检查、ESLint 与生产构建

## 本地运行

需要 Node.js 22.13 或更高版本。

```bash
npm install
npm run dev
```

浏览器打开 `http://localhost:4173`。进入比赛后使用 WASD 移动、鼠标瞄准射击、空格跳跃、C 蹲下、Shift 冲刺、R 换弹；在目标点按住 E 安放或拆除 C4，`1` / `2` 切枪，`G` 丢枪，`Shift+G` 丢 C4。单人训练为玩家对四名 Bot 的练习模式。

对局中可点击“退出对局”返回模式选择；交战时按 Esc 可打开包含退出按钮的暂停菜单。联机主动退出会立即释放房间席位。

如果浏览器拒绝鼠标锁定，比赛会继续运行，可按住鼠标拖动视角。

## 局域网联机

在作为房主的电脑上启动网页与房间服务器：

```bash
npm run dev:multiplayer
```

房主浏览器打开 `http://localhost:4173`；同一 Wi-Fi 或有线局域网中的其他玩家打开 `http://<房主局域网IP>:4173`。一名玩家选择“创建房间”并分享五位房间码，其余玩家选择“加入房间”。服务器会将玩家自动平衡到 ALPHA 与 BRAVO，并为双方补充 Bot；1–10 名玩家均可开始，人数增加时 Bot 会自动让出席位。

联机服务器默认监听 `8787` 端口，网页开发服务器监听 `4173` 端口；操作系统防火墙需要允许这两个端口的局域网访问。也可以分别运行：

```bash
npm run multiplayer-server
npm run dev
```

联机版同步队伍、玩家、Bot、生命、护甲、主副武器、弹药、掉落物、经济、攻守角色和 C4 状态。服务器统一裁定命中、友伤屏蔽、安放/拆除进度及回合胜负；多人同时拾取同一物品时只有最先通过服务器校验的玩家能够获得。

## 验证

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

## 容器

在项目目录执行一条命令即可构建并启动网页、房间服务器和反向代理：

```bash
docker compose up -d --build
```

浏览器打开 `http://localhost:8080`；同一局域网的其他设备打开 `http://<房主局域网IP>:8080`。Compose 只对外开放网页端口，WebSocket 通过同源 `/multiplayer` 反代，不需要开放 `8787`。

如需更换网页端口，例如改为 `9090`：

```bash
BREACHLINE_HTTP_PORT=9090 docker compose up -d --build
```

查看状态、日志或停止服务：

```bash
docker compose ps
docker compose logs -f game
docker compose down
```

房间状态保存在进程内存中，重启容器会结束现有房间。

## 武器资产与视觉检查

手枪使用 Mateusz Sadek / Poly Haven 的 Service Pistol；BR-4 使用 nisu / 3DModelsCC0 的 M4A1。两套资产均为 CC0，原始纹理、转换脚本和来源哈希记录在 `public/models/`。运行时不需要访问外部模型服务，也没有新增模型加载依赖。原 PNG 枪械图仍仅用于购买菜单预览。

开发服务器的 `/tests/visual/model-review.html` 可检查武器/操作员、开火定格、换弹阶段和移动动作。该检查页不进入生产构建。

操作员衣裤与手套基于 MakeHuman Community CC0 人体网格加工，装备、服装细节及四类新枪在本地 Blender 制作。运行时读取 `public/models/` 的紧凑 JSON/GLB 网格；角色步态、脚掌接地、蹲起和换弹接触仍由程序 IK 与关键阶段驱动。当前没有动作捕捉动画、CS2 原版资产或已经达到 AAA 角色动作的声明。

- 全身操作员：`assets/blender/skinned-operator/operator.blend`、`assets/blender/skinned-operator/pose-review.blend`；重建脚本 `scripts/blender/build_skinned_operator.py`；运行时包 `public/models/skinned-operator/`；许可与来源清单 `public/models/skinned-operator/LICENSE.CC0.md`、`public/models/skinned-operator/manifest.json`、`public/models/skinned-operator/validation.json`。运行时使用 18 骨 Skeleton、四权重槽 GPU skinning、世界脚掌锚点和两骨 IK。
- 第一人称手部：`assets/blender/weighted-hands/weighted-tactical-hands.blend`；重建脚本 `scripts/blender/build_weighted_hands.py`；运行时包 `public/models/weighted-hands/`；许可与来源清单 `public/models/weighted-hands/LICENSE.ASSETS.md`、`public/models/weighted-hands/manifest.json`。每只手 16 骨，支持 open/grip 插值，掌心接触点跟随枪械弹匣、拉机柄和装填位置。
- 旧的 `assets/blender/operator/industrial-tactical-operator.blend`、`scripts/blender/build_operator.py`、`assets/blender/hands/tactical-hands.blend` 和 `scripts/blender/build_hands.py` 保留为早期分块/静态参考来源；当前角色与第一人称手部运行时以 `skinned-operator` 和 `weighted-hands` 包为准。

### 本地模型重建

Blender 4.5 LTS 可在后台重建原始模型；以下脚本使用独立场景，不操作编辑器中打开的工程：

```bash
blender --background --factory-startup --threads 4 --python scripts/blender/build_weapons.py -- --skip-render
blender --background --factory-startup --threads 4 --python scripts/blender/build_skinned_operator.py
blender --background --factory-startup --threads 4 --python scripts/blender/build_weighted_hands.py
```

Mac 当前 Blender 路径为 `~/Applications/Blender.app/Contents/MacOS/Blender`。MakeHuman 原始网格、授权和来源记录保存在各自 `reference/` 目录及运行时包的 manifest/license 文件中。两套原有 CC0 枪械也已保存原始输入，可用 `python3 scripts/fetch_weapon_sources.py` 按 SHA256 恢复，再运行对应的 `convert-*.py`。渲染预览只作为检查素材，实际渲染还需在 `/tests/visual/model-review.html` 检查。

## 扩建地图验证

新图采用平层竞技拆弹布局，B 仓库南门、西侧连接门、北门都是真正通行的开口。A/B 都有绕行路线和高低掩体，出生区之间被建筑遮挡。雷达按真实地图比例显示，区域名来自共享配置。协议版本已升级为 5；联机双方须刷新到同一构建。

共享导航图的规划距离为 T→A 约 125.6m、T→B 约 122.1m、CT→两点约 61.9m、A→B 约 79m。这些是规划图距离，不是 CS2 官方地图尺寸，也不包含交火、停顿或 Recast 的路径平滑。权威 Bot 的十人进点、安包和回防拆弹均由测试覆盖。

开发地图检视页为 `/tests/visual/map-review.html`，包含 A/B、中路、出生区和鸟瞰视角。工业装饰会合并为静态材质批次，碰撞盒和导航数据仍独立保留。当前可玩空间为地面道路与室内通道。
