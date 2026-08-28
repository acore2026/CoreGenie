// Anything with "null" requires a translation. Contribute to translation via a PR!
const TRANSLATIONS = {
  onboarding: {
    home: {
      getStarted: "开始",
      welcome: "欢迎",
    },
    llm: {
      title: "LLM 偏好",
      description:
        "CoreGenie 可以与多家 LLM 提供商合作。这将是处理聊天的服务。",
    },
    userSetup: {
      title: "用户设置",
      description: "配置你的用户设置。",
      howManyUsers: "将有多少用户使用此实例？",
      justMe: "只有我",
      myTeam: "我的团队",
      instancePassword: "实例密码",
      setPassword: "你想要设置密码吗？",
      passwordReq: "密码必须至少包含 8 个字符。",
      passwordWarn: "保存此密码很重要，因为没有恢复方法。",
      adminUsername: "管理员账户用户名",
      adminPassword: "管理员账户密码",
      adminPasswordReq: "密码必须至少包含 8 个字符。",
      teamHint:
        "默认情况下，你将是唯一的管理员。完成初始设置后，你可以创建和邀请其他人成为用户或管理员。不要丢失你的密码，因为只有管理员可以重置密码。",
    },
    data: {
      title: "数据处理与隐私",
      description: "我们致力于在涉及你的个人数据时提供透明度和控制权。",
      settingsHint: "这些设置可以随时在设置中重新配置。",
    },
    survey: {
      title: "欢迎使用 CoreGenie",
      description: "帮助我们为你的需求打造 CoreGenie。可选。",
      email: "你的电子邮件是什么？",
      useCase: "你将如何使用 CoreGenie？",
      useCaseWork: "用于工作",
      useCasePersonal: "用于个人使用",
      useCaseOther: "其他",
      comment: "你是如何听说 CoreGenie 的？",
      commentPlaceholder:
        "Reddit，Twitter，GitHub，YouTube 等 - 让我们知道你是如何找到我们的！",
      skip: "跳过调查",
      thankYou: "感谢你的反馈！",
    },
  },
  common: {
    "workspaces-name": "工作区名称",
    selection: "模型选择",
    save: "保存更改",
    saving: "保存中...",
    previous: "上一页",
    next: "下一页",
    optional: "可选",
    yes: "是",
    no: "否",
    search: "搜索",
    username_requirements:
      "用户名必须为 2-64 个字符，以小写字母开头，只能包含小写字母、数字、下划线、连字符和句点。",
    on: "关于",
    none: "没有",
    stopped: "停止",
    loading: "正在加载…",
    refresh: "重新开始；更新",
  },
  settings: {
    title: "设置",
    "back-to-chat": "返回聊天",
    invites: "邀请",
    users: "用户",
    workspaces: "工作区",
    "workspace-chats": "对话历史记录",
    customization: "外观",
    interface: "界面偏好",
    branding: "品牌与白标签化",
    chat: "聊天",
    "api-keys": "开发者API",
    llm: "大语言模型（LLM）",
    transcription: "转录模型",
    embedder: "嵌入器（Embedder）",
    "text-splitting": "文本分割",
    "voice-speech": "语音和讲话",
    "vector-database": "向量数据库",
    embeds: "嵌入式对话",
    security: "用户与安全",
    "event-logs": "事件日志",
    privacy: "隐私与数据",
    "ai-providers": "人工智能提供商",
    "agent-skills": "Agent技能",
    agents: "Agents",
    "predefined-agent-skills": "Skills",
    "agent-tools": "Agent Tools",
    "agent-prompts": "提示词",
    admin: "管理员",
    tools: "工具",
    "experimental-features": "实验功能",
    contact: "联系支持",
    "browser-extension": "浏览器扩展",
    "system-prompt-variables": "系统提示变量",
    "mobile-app": "CoreGenie 移动版",
    "community-hub": {
      title: "社区中心",
      trending: "探索热门",
      "your-account": "您的账户",
      "import-item": "进口商品",
    },
    channels: "频道",
    "available-channels": {
      telegram: "电报",
    },
    "scheduled-jobs": "计划好的任务",
    "model-router": "型号路由器",
  },
  agent_prompts: {
    title: "提示词层级",
    description: "设置应用于所有普通对话和 Agent 任务的全局指令。",
    global_label: "全局系统提示词",
    global_help: "这些指令始终会被加入，并且优先于 Agent 提示词和个人提示词。",
    placeholder: "定义组织级规则、回复规范、安全要求或共享背景信息…",
    stack_title: "指令优先级",
    layer_global: "全局提示词",
    layer_global_detail: "由管理员控制，优先级最高。",
    layer_agent: "Agent 提示词",
    layer_agent_detail: "定义身份和任务专属行为。",
    layer_user: "个人提示词",
    layer_user_detail: "来自帐户设置的个人偏好。",
    saved: "全局系统提示词已保存。",
    save_error: "无法保存全局系统提示词。",
  },
  login: {
    "multi-user": {
      welcome: "欢迎！",
      "placeholder-username": "请输入用户名",
      "placeholder-password": "请输入密码",
      login: "登录",
      validating: "正在验证...",
      "forgot-pass": "忘记密码",
      reset: "重置",
    },
    "sign-in": "登录你的 {{appName}} 账户",
    registration: {
      title: "创建账户",
      description: "注册以访问此 CoreGenie 实例。",
      "create-account": "创建账户",
      creating: "正在创建账户...",
      "confirm-password": "确认密码",
      "already-have-account": "已有账户？立即登录",
      failed: "注册失败。",
      "complete-title": "账户已创建",
      "complete-description":
        "你的账户已准备就绪。开始聊天前，管理员可能需要为你分配工作区。",
      "sign-in": "继续登录",
    },
    "password-reset": {
      title: "重置密码",
      description: "请提供以下必要信息以重置你的密码。",
      "recovery-codes": "恢复代码",
      "back-to-login": "返回登录",
    },
  },
  "main-page": {
    quickActions: {
      createAgent: "创建Agent",
      editWorkspace: "编辑工作区",
      uploadDocument: "上传文件",
    },
    greeting: "今天我能帮您什么？",
  },
  help: {
    navigation: "帮助与示例",
    intro: {
      title: "不知道从哪里开始？先看一个示例",
      description: "选一个助手，填写任务范围，确认后再发送。",
      action: "查看指南",
      dismiss: "关闭首次使用提示",
    },
    actions: {
      copy: "复制提示词",
      copied: "提示词已复制",
      copy_failed: "无法复制提示词。",
      use_agent: "使用此助手",
      try_example: "试用示例",
      workspace_required: "需要工作区",
    },
    launcher: {
      eyebrow: "选择助手",
      title: "先选助手，再开始提问",
      description: "这里列出当前可以使用的助手。",
      agent_list: "可用助手",
      ready: "可以开始工作",
      empty_title: "当前没有启用的助手",
      empty_description: "请联系管理员启用至少一个助手。",
      input_label: "你需要提供",
      output_label: "你将获得",
      examples_label: "可以直接使用的示例",
      select_agent: "选择一个助手以查看它的工作方式。",
    },
    agent_profiles: {
      general: {
        label: "日常任务",
        description: "处理日常问答、写作、文件和一般分析。",
        input: "直接写问题、上传文件，或说明希望得到什么结果。",
        output: "回答、摘要、对比、草稿或文件分析。",
        examples: [
          "总结我上传的文档，列出主要结论，并标出还需要确认的信息。",
          "从目标、方法、差异、风险和待解决问题五个方面比较这两份文档。",
          "把我的零散笔记整理成一份简洁的技术简报，并附上行动清单。",
        ],
      },
      review: {
        label: "会议 / TDoc 分析",
        description: "分析一次会议、一个 KI 或一组提案。",
        input: "工作组、会议号、KI/议程项，以及相关 TDoc 编号或公司范围。",
        output: "提案对比表、流程分析、资料完整性检查和中文报告。",
        examples: [
          "分析指定 SA2 会议和 KI 的主要提案，比较架构路线、关键流程与待解决问题。",
          "分析我提供的 TDoc，区分提案方主张与会议结果，并输出中文报告。",
          "比较这些提案中的消息流程，并逐一检查流程图。",
        ],
      },
      converter: {
        label: "DOCX 格式转换",
        description: "把 3GPP 提案转成 Markdown，并保留原图和嵌入对象。",
        input: "上传 DOCX，或提供 TDoc 编号、工作组和会议信息。",
        output: "包含 Markdown、图片、嵌入对象和转换说明的 ZIP。",
        examples: [
          "请把我上传的提案转换成 Markdown 和图片压缩包。",
          "请下载 S2-2606085，并转换成 Markdown 和图片压缩包。",
          "把这个 DOCX 的表格、图片和 Visio 图按原文顺序整理成 Markdown。",
        ],
      },
      evolution: {
        label: "公司技术路线分析",
        description: "查看一家公司在多次会议中的立场和技术路线变化。",
        input: "公司、工作组、KI/WI 或技术主题、会议范围，以及资料截至日期。",
        output: "按会议整理的 TDoc 清单、技术路线变化、各公司立场和最终结果。",
        examples: [
          "追踪某公司从 2025 年至最近一次已结束会议在指定 KI 上的技术路线。",
          "跨会议比较两家公司，并区分明确反对、保留意见和竞争方案。",
          "更新已有立场分析，只总结最新提案、状态变化和尚未解决的问题。",
        ],
      },
    },
    saved_examples: {
      eyebrow: "真实运行示例",
      title: "直接查看一次真实分析结果",
      description:
        "下面的内容保存自一次已完成的 KI #18 分析。展开后直接查看，不会再次调用模型，也不会创建新任务。",
      completed: "真实运行",
      view: "查看完整结果",
      view_short: "查看",
      table_hint: "左右滑动查看完整表格",
      prompt_label: "原始任务",
      result_label: "助手结果",
      items: [
        {
          id: "huawei-ericsson-ki18",
          title: "Huawei 与 Ericsson 在 KI #18 上的架构分歧",
          description:
            "查看双方的核心路线、Ericsson 的保留意见、关键 TDoc 和会议状态。",
          agent: "3GPP 技术路线与立场分析助手 · 2026-08-28",
          reading_time: "约 5 分钟",
          disclaimer:
            "内容来自 2026 年 8 月 28 日已完成并发布的 KI #18 Huawei 纵向分析，本页保留其中与 Ericsson 相关的完整专题结果。结论以当次运行能够取得的 3GPP 材料为准，限制项也一并保留。",
          prompt:
            "分析 Huawei 从 2025 年至最近一次 SA2 FS_6G_ARC KI #18 关于 Agentic Core / NW-Agent 的全部相关提案，说明公司立场、技术路线、术语演进、主要反对者及证据等级，并生成可复核报告。",
          result: {
            title: "Huawei 与 Ericsson：NW-Agent 和 AI Domain 两条路线",
            summary:
              "Huawei 主张在 6G 核心网中引入专用 Network AI Agent（NW-Agent）网络功能；Ericsson 主要推动独立的 AI Domain，并配合 AI-capable NF 完成推理、训练和传输。Ericsson 对 NW-Agent 的术语定义提出关切，但现有材料不支持把 Ericsson 写成明确反对 Huawei 整体路线。更准确的判断是：条件性保留意见，加上直接竞争的架构路线。",
            sections: [
              {
                title: "运行信息",
                table: {
                  headers: ["项目", "内容"],
                  rows: [
                    ["任务状态", "已完成，报告已发布到 3GPP 工作区知识库。"],
                    [
                      "分析范围",
                      "SA2#173 至 SA2#176，FS_6G_ARC，KI #18，目标规范 TR 23.801-01。",
                    ],
                    [
                      "资料快照",
                      "2026-08-28；来自 3GPP 官方 FTP 的会议 TDoc 和工作区中已解析的讨论资料。",
                    ],
                    [
                      "Huawei 覆盖",
                      "Huawei/HiSilicon 相关 TDoc 共 88 份，已全部下载并提取文本。",
                    ],
                  ],
                },
              },
              {
                title: "核心架构分歧",
                table: {
                  headers: ["对比项", "Huawei", "Ericsson"],
                  rows: [
                    [
                      "核心实体",
                      "专用 Network AI Agent（NW-Agent）网络功能。",
                      "独立于 PS 域的 AI Domain，并结合 AI-capable NF。",
                    ],
                    [
                      "主要职责",
                      "解释请求和意图，发现并调用工具，协调闭环操作。",
                      "承载 AI 相关能力、模型推理与训练，并处理到 AI Domain 的传输。",
                    ],
                    [
                      "主要 SV",
                      "SV#18.0、18.1、18.6、18.16、18.19。",
                      "SV#3，并覆盖 SV#18.3、18.6、18.7、18.8、18.13、18.21、18.22。",
                    ],
                    [
                      "路线关系",
                      "以 NW-Agent 为中心组织意图处理和工具调用。",
                      "以 AI Domain 为架构基础，是与 NW-Agent 并行的主要竞争路线。",
                    ],
                  ],
                },
              },
              {
                title: "Ericsson 的反对和保留意见",
                paragraphs: [
                  "在 SA2#175-AH-e 的 SV#18.0 术语讨论中，Ericsson 对 Huawei/HiSilicon 牵头的 S2-2606200 提出“对 NW AI Agent 定义的关切”。原运行据此将 Ericsson 归为条件性保留意见，而不是明确反对者。",
                  "这轮讨论后，S2-2606573 获批，但只保留原则性内容，具体术语定义被推迟。后续 S2-2608467 中仍有术语内容标为 FFS。现有资料能证明 Ericsson 对定义有保留，但不能证明其反对 NW-Agent 或 Agentic Core 的全部内容。",
                ],
                bullets: [
                  "明确反对：没有找到 Ericsson 明确表示“不支持”或“反对”Huawei 整体路线的证据。",
                  "保留意见：对 NW-Agent 术语定义的具体内容提出关切。",
                  "竞争路线：持续推动 AI Domain，并形成独立获批的 SV#3 baseline。",
                ],
              },
              {
                title: "关键 TDoc 和会议状态",
                table: {
                  headers: ["TDoc", "公司 / 会议", "内容", "状态"],
                  rows: [
                    [
                      "S2-2600182",
                      "Huawei · SA2#173",
                      "首次提出 Agentic Core 和 NW-Agent。",
                      "Not Handled",
                    ],
                    [
                      "S2-2602109",
                      "Huawei · SA2#174",
                      "扩展工具注册、Agent 间通信、漫游和闭环操作。",
                      "Not Handled",
                    ],
                    [
                      "S2-2606200 → S2-2606573",
                      "Huawei · SA2#175-AH-e",
                      "NW-Agent 术语 baseline；讨论后仅保留原则，定义推迟。",
                      "Approved",
                    ],
                    [
                      "S2-2601907",
                      "Ericsson · SA2#174",
                      "提出 6G CN AI Domain。",
                      "Revised",
                    ],
                    [
                      "S2-2605619",
                      "Ericsson 等 · SA2#175",
                      "SV#3：在 6G CN 中建立独立于 PS 域的新域。",
                      "Approved",
                    ],
                    [
                      "S2-2606610",
                      "Ericsson 等 · SA2#175-AH-e",
                      "更新 SV#3 AI Domain baseline。",
                      "Approved",
                    ],
                    [
                      "S2-2608454",
                      "Ericsson 等 · SA2#176",
                      "继续更新 SV#3 AI Domain baseline。",
                      "Approved，临时状态",
                    ],
                  ],
                },
              },
              {
                title: "结果判断",
                paragraphs: [
                  "Ericsson 是 Huawei NW-Agent 路线的主要架构竞争者，但不是现有证据下的明确反对者。双方最实质的分歧是：由专用 NW-Agent 作为核心实体，还是建立独立 AI Domain 并把 AI 能力分布到域和现有 NF 中。",
                  "两条路线都形成了获批 baseline，不能写成一方已经击败另一方。到 SA2#176，Huawei 的 baseline 中明显增加了 AI Domain 概念，说明讨论正在从路线竞争走向并行和融合。",
                ],
              },
              {
                title: "资料范围和限制",
                bullets: [
                  "本次运行完成时，SA2#176 的正式会议报告尚未发布，因此相关会议结果按临时状态处理。",
                  "Ericsson 的关切来自 SA2#175-AH-e baseline comments 的讨论摘要；原始逐字讨论记录没有作为独立文件保存在工作区，因此该项置信度为中。",
                  "Huawei/HiSilicon 的 88 份相关 TDoc 已完成全文提取；竞争方材料的全文覆盖不完整，深层技术细节仍需继续核对原文。",
                  "本次运行没有逐张检查 TDoc 中的架构图。流程图或架构图看不清时，不能据此补充推断。",
                  "公司提案不等于 3GPP 已采纳的结论；是否通过仍以会议结果和正式材料为准。",
                ],
              },
            ],
          },
        },
      ],
    },
    capabilities: {
      eyebrow: "工作台能做什么",
      title: "适合需要查资料、做对比的研究任务",
      items: [
        {
          title: "使用文档和工作区资料",
          description: "上传文件、搜索工作区资料，并把有用结果保存下来。",
        },
        {
          title: "让助手分步完成任务",
          description:
            "助手可以拆分任务、调用工具和 Skill，遇到信息不足时会向你提问。",
        },
        {
          title: "查看 TDoc 和流程图",
          description: "可以分别处理 TDoc、表格、流程图、文档版本和会议结果。",
        },
        {
          title: "把提案转成 Markdown",
          description:
            "上传 DOCX 或提供 TDoc 信息，生成 Markdown 和原图压缩包。",
        },
        {
          title: "整理并保存报告",
          description:
            "分析完成后可以生成 Markdown 报告，并保存到工作区知识库。",
        },
      ],
    },
    faq: {
      eyebrow: "FAQ",
      title: "常见问题",
      description: "先了解模型、执行时间和结果保存方式，再决定是否开始任务。",
      items: [
        {
          question: "助手背后的大模型是什么？",
          answer:
            "当前部署主要使用 GLM-5.2 处理文字和分析任务；查看流程图、架构图等图片时使用 Qwen3.7-plus。不同工作区可以配置不同模型，后续也可能调整。",
        },
        {
          question: "为什么试用示例需要较长时间？",
          answer:
            "3GPP 分析通常需要查找和下载 TDoc、解析文档、检查流程图，再整理报告。复杂任务可能需要几分钟。只想了解结果形式时，可以直接查看上面的真实运行示例。",
        },
        {
          question: "试用示例会自动发送吗？",
          answer:
            "不会。点击“试用示例”后，内容只会填入工作台输入框，你可以修改并确认后再发送。",
        },
        {
          question: "分析结果会保存在哪里？",
          answer:
            "对话会保存在当前工作区。需要长期使用的正式报告可以加入工作区知识库，之后继续搜索和引用。",
        },
      ],
    },
    concepts: {
      eyebrow: "关键概念",
      title: "几个常用概念",
      items: [
        {
          term: "工作区",
          description: "集中保存对话、参考文档、文件和分析结果的地方。",
        },
        {
          term: "助手",
          description: "针对不同任务准备的专用助手。",
        },
        {
          term: "Skill",
          description: "为特定任务准备的一组说明、脚本和参考资料。",
        },
        {
          term: "参考资料",
          description: "分析时使用的 TDoc、会议记录和相关文件。",
        },
      ],
    },
    boundaries: {
      title: "使用时请注意",
      items: ["本项目在外网部署。注意信息安全，不要上传非公开信息。"],
    },
    states: {
      no_workspace:
        "你当前还没有获分配工作区。请联系管理员开通访问权限后再启动示例。",
    },
  },
  "new-workspace": {
    title: "新工作区",
    placeholder: "我的工作区",
  },
  "sidebar-create": {
    title: "新建",
    thread: "新建对话",
    "creating-thread": "正在创建对话…",
    "thread-hint": "在当前工作区中",
    workspace: "新建工作区",
    "confirm-workspace": "创建工作区",
    "creating-workspace": "正在创建工作区…",
    "workspace-hint": "创建独立工作空间",
    "no-workspace": "请先创建或选择工作区。",
    "thread-failed": "创建对话失败。",
  },
  "workspace-invite": {
    action: "邀请成员加入工作区",
    "import-documents": "向此工作区添加文档",
    title: "邀请成员加入工作区",
    close: "关闭",
    description: "将此链接分享给你想邀请加入此工作区的人。",
    generating: "正在生成邀请链接…",
    retry: "重试",
    "link-label": "工作区邀请链接",
    copied: "工作区邀请链接已复制",
    "copy-failed": "无法自动复制，请选中链接后手动复制。",
    "copied-short": "已复制",
    copy: "复制",
    reusable:
      "此链接可重复使用。已登录用户可直接加入，新用户可在邀请页面注册后加入。",
    "join-failed": "无法加入此工作区。",
    "invited-to": "你受邀加入",
    "a-workspace": "一个工作区",
    "join-as": "以 {{username}} 的身份加入，并将此工作区添加到你的账户。",
    joining: "正在加入…",
    join: "加入工作区",
    "sign-in-again": "重新登录",
    "register-title": "加入 {{workspace}}",
    "register-fallback-title": "加入此工作区",
    "register-description": "创建账户后，你将自动加入此工作区。",
    "register-and-join": "注册并加入",
    registering: "正在创建账户…",
    "already-account": "已有账户？立即登录",
    username: "用户名",
    "username-placeholder": "设置用户名",
    password: "密码",
    "password-placeholder": "设置密码",
  },
  "workspaces—settings": {
    general: "通用设置",
    chat: "聊天设置",
    vector: "向量数据库",
    members: "成员",
    agent: "Agent配置",
  },
  general: {
    vector: {
      title: "向量数量",
      description: "向量数据库中的总向量数。",
    },
    names: {
      description: "这只会更改工作区的显示名称。",
    },
    message: {
      title: "建议的聊天消息",
      description: "自定义将向你的工作区用户建议的消息。",
      add: "添加新消息",
      save: "保存消息",
      heading: "向我解释",
      body: "CoreGenie 的好处",
    },
    delete: {
      title: "删除工作区",
      description: "删除此工作区及其所有数据。这将删除所有用户的工作区。",
      delete: "删除工作区",
      deleting: "正在删除工作区...",
      "confirm-start": "你即将删除整个",
      "confirm-end":
        "工作区。这将删除矢量数据库中的所有矢量嵌入。\n\n原始源文件将保持不变。此操作是不可逆转的。",
    },
  },
  chat: {
    llm: {
      title: "工作区 LLM 提供者",
      description:
        "将用于此工作区的特定 LLM 提供商和模型。默认情况下，它使用系统 LLM 提供程序和设置。",
      search: "搜索所有 LLM 提供商",
    },
    model: {
      title: "工作区聊天模型",
      description:
        "将用于此工作区的特定聊天模型。如果为空，将使用系统 LLM 首选项。",
    },
    mode: {
      title: "聊天模式",
      chat: {
        title: "聊天",
        description:
          "将提供答案，利用LLM的通用知识和提供的文档内容<b>和</b>。您需要使用@agent命令来使用工具。",
      },
      query: {
        title: "查询",
        description:
          "将在找到文档上下文时，仅提供答案 <b>。您需要使用 @agent 命令来使用工具。",
      },
      automatic: {
        description:
          "如果模型和提供者都支持原生工具调用，则会自动使用这些工具。<br />如果不支持原生工具调用，您需要使用 `@agent` 命令来使用工具。",
        title: "Agent",
      },
    },
    history: {
      title: "聊天历史记录",
      "desc-start": "将包含在响应的短期记忆中的先前聊天的数量。",
      recommend: "推荐 20。",
    },
    prompt: {
      title: "系统提示词",
      description:
        "将在此工作区上使用的提示词。定义 AI 生成响应的上下文和指令。你应该提供精心设计的提示，以便人工智能可以生成相关且准确的响应。",
      history: {
        title: "系统提示词历史",
        clearAll: "全部清除",
        noHistory: "没有可用的系统提示词历史记录",
        restore: "恢复",
        delete: "删除",
        deleteConfirm: "您确定要删除此历史记录吗？",
        clearAllConfirm: "您确定要清除所有历史记录吗？此操作无法撤消。",
        expand: "展开",
        publish: "发布到社区中心",
      },
    },
    refusal: {
      title: "查询模式拒绝响应",
      "desc-start": "当处于",
      query: "查询",
      "desc-end": "模式时，当未找到上下文时，你可能希望返回自定义拒绝响应。",
      "tooltip-title": "我为什麽会看到这个?",
      "tooltip-description":
        "您处于查询模式，此模式仅使用您文件中的信息。切换到聊天模式以进行更灵活的对话，或点击此处访问我们的文件以了解更多关于聊天模式的信息。",
    },
    temperature: {
      title: "LLM 温度",
      "desc-end":
        "数字越高越有创意。对于某些模型，如果设置得太高，可能会导致响应不一致。",
    },
  },
  "vector-workspace": {
    identifier: "向量数据库标识符",
    snippets: {
      title: "最大上下文片段",
      description:
        "此设置控制每次聊天或查询将发送到 LLM 的上下文片段的最大数量。",
      recommend: "推荐: 4",
    },
    doc: {
      title: "文档相似性阈值",
      description:
        "源被视为与聊天相关所需的最低相似度分数。数字越高，来源与聊天就越相似。",
      zero: "无限制",
      low: "低（相似度分数 ≥ .25）",
      medium: "中（相似度分数 ≥ .50）",
      high: "高（相似度分数 ≥ .75）",
    },
    reset: {
      reset: "重置向量数据库",
      resetting: "清除向量...",
      confirm:
        "你将重置此工作区的矢量数据库。这将删除当前嵌入的所有矢量嵌入。\n\n原始源文件将保持不变。此操作是不可逆转的。",
      success: "向量数据库已重置。",
      error: "无法重置工作区向量数据库！",
    },
  },
  agent: {
    "performance-warning":
      "不明确支持工具调用的 LLMs 的性能高度依赖于模型的功能和准确性。有些能力可能受到限制或不起作用。",
    provider: {
      title: "工作区Agent LLM 提供商",
      description: "将用于此工作区的 @agent Agent的特定 LLM 提供商和模型。",
    },
    mode: {
      chat: {
        title: "工作区Agent聊天模型",
        description: "将用于此工作区的 @agent Agent的特定聊天模型。",
      },
      title: "工作区Agent模型",
      description: "将用于此工作区的 @agent Agent的特定 LLM 模型。",
      wait: "-- 等待模型 --",
    },
    skill: {
      rag: {
        title: "检索增强生成和长期记忆",
        description:
          '允许Agent利用你的本地文档来回答查询，或要求Agent"记住"长期记忆检索的内容片段。',
      },
      view: {
        title: "查看和总结文档",
        description: "允许Agent列出和总结当前嵌入的工作区文件的内容。",
      },
      scrape: {
        title: "抓取网站",
        description: "允许Agent访问和抓取网站的内容。",
      },
      generate: {
        title: "生成图表",
        description: "使默认Agent能够从提供的数据或聊天中生成各种类型的图表。",
      },
      web: {
        title: "实时网络搜索和浏览",
        description:
          "通过连接到搜索引擎（SERP）提供商，让您的Agent能够搜索互联网来回答您的问题。",
      },
      sql: {
        title: "SQL 连接器",
        description:
          "让您的Agent能够利用 SQL 来回答您的问题，只需连接到各种 SQL 数据库提供商即可。",
      },
      default_skill:
        "默认情况下，这项技能已启用。但是，如果您不想让该技能被Agent使用，您可以将其禁用。",
      filesystem: {
        title: "文件系统访问",
        description:
          "允许您的Agent能够读取、写入、搜索和管理指定目录中的文件。 支持文件编辑、目录导航和内容搜索功能。",
        learnMore: "了解更多关于如何使用这项技能的信息。",
        configuration: "配置",
        readActions: "阅读操作",
        writeActions: "编写操作",
        warning:
          "访问文件系统可能存在风险，因为它可能修改或删除文件。在启用之前，请务必查阅<a>文档</a>。",
        skills: {
          "read-text-file": {
            title: "读取文件",
            description: "读取文件内容（包括文本、代码、PDF、图像等）",
          },
          "read-multiple-files": {
            title: "读取多个文件",
            description: "同时读取多个文件",
          },
          "list-directory": {
            title: "目录",
            description: "列出文件夹中的文件和目录",
          },
          "search-files": {
            title: "搜索文件",
            description: "按文件名或内容搜索文件",
          },
          "get-file-info": {
            title: "获取文件信息",
            description: "获取有关文件的详细元数据",
          },
          "edit-file": {
            title: "编辑文件",
            description: "对文本文件进行基于行的编辑。",
          },
          "create-directory": {
            title: "创建目录",
            description: "创建新的目录",
          },
          "move-file": {
            title: "移动/重命名文件",
            description: "移动或重命名文件和目录",
          },
          "delete-path": {
            title: "删除文件/目录",
            description: "永久删除工作区内的文件或目录",
          },
          "copy-file": {
            title: "复制文件",
            description: "复制文件和目录",
          },
          "write-text-file": {
            title: "创建文本文件",
            description: "创建新的文本文件，或覆盖现有的文本文件。",
          },
        },
      },
      createFiles: {
        title: "文档创建",
        description:
          "允许您的Agent创建二进制文档格式，例如PowerPoint演示文稿、Excel电子表格、Word文档和PDF文件。文件可以直接从聊天窗口下载。",
        configuration: "可用的文件类型",
        skills: {
          "create-text-file": {
            title: "文本文件",
            description:
              "创建包含任何内容和扩展名的文本文件（如 .txt、.md、.json、.csv 等）。",
          },
          "create-pptx": {
            title: "PowerPoint 演示文稿",
            description: "创建新的幻灯片演示文稿，包括幻灯片、标题和项目符号。",
          },
          "create-pdf": {
            title: "PDF 文档",
            description:
              "使用 Markdown 或纯文本，并进行基本的排版，创建 PDF 文档。",
          },
          "create-xlsx": {
            title: "Excel电子表格",
            description: "创建包含表格数据、工作表和样式的 Excel 文档。",
          },
          "create-docx": {
            title: "Word 文档",
            description: "创建包含基本样式和格式的 Word 文档",
          },
        },
      },
      gmail: {
        title: "Gmail 连接器",
        description:
          "让您的Agent能够与Gmail互动：搜索邮件、阅读邮件线程、撰写草稿、发送邮件以及管理您的收件箱。请参考相关文档。",
        multiUserWarning:
          "为了安全原因，在多用户模式下无法使用 Gmail 集成功能。请先禁用多用户模式，然后才能使用此功能。",
        configuration: "Gmail 设置",
        deploymentId: "部署 ID",
        deploymentIdHelp: "您的 Google Apps Script 网页应用的部署 ID",
        apiKey: "API 密钥",
        apiKeyHelp: "您在 Google Apps Script 部署中配置的 API 密钥。",
        configurationRequired: "请配置部署 ID 和 API 密钥，以启用 Gmail 功能。",
        configured: "已配置",
        searchSkills: "搜索技巧...",
        noSkillsFound: "未找到与您的搜索条件匹配的技能。",
        categories: {
          search: {
            title: "搜索和阅读电子邮件",
            description: "搜索并阅读您 Gmail 收件箱中的邮件。",
          },
          drafts: {
            title: "草稿邮件",
            description: "创建、编辑和管理电子邮件草稿",
          },
          send: {
            title: "发送和回复电子邮件",
            description: "立即发送电子邮件并回复讨论串",
          },
          threads: {
            title: "管理电子邮件线程",
            description: "管理邮件线程 - 标记为已读/未读，归档，删除",
          },
          account: {
            title: "集成统计",
            description: "查看邮件收件箱统计数据和账户信息",
          },
        },
        skills: {
          search: {
            title: "搜索邮件",
            description: "使用 Gmail 的查询语法搜索电子邮件",
          },
          readThread: {
            title: "阅读此主题",
            description: "阅读由ID发起的完整邮件往来",
          },
          createDraft: {
            title: "创建草稿",
            description: "创建一个新的电子邮件草稿",
          },
          createDraftReply: {
            title: "创建草稿回复",
            description: "创建一个针对现有主题的回应草稿",
          },
          updateDraft: {
            title: "更新草稿",
            description: "更新已有的电子邮件草稿",
          },
          getDraft: {
            title: "获取草稿",
            description: "通过ID检索特定草稿",
          },
          listDrafts: {
            title: "草稿清单",
            description: "列出所有草稿邮件",
          },
          deleteDraft: {
            title: "删除草稿",
            description: "删除草稿邮件",
          },
          sendDraft: {
            title: "发送草稿",
            description: "发送已有的电子邮件草稿",
          },
          sendEmail: {
            title: "发送电子邮件",
            description: "立即发送一封电子邮件",
          },
          replyToThread: {
            title: "回复主题",
            description: "立即回复邮件线程",
          },
          markRead: {
            title: "马克·瑞德",
            description: "将某个主题标记为已阅读",
          },
          markUnread: {
            title: "标记为未读",
            description: "将某个主题标记为未读",
          },
          moveToTrash: {
            title: "移动到垃圾箱",
            description: "将某个主题归档到垃圾箱",
          },
          moveToArchive: {
            title: "存档",
            description: "存档该主题",
          },
          moveToInbox: {
            title: "移动到收件箱",
            description: "将某个主题移动到收件箱",
          },
          getMailboxStats: {
            title: "邮箱统计",
            description: "获取未读邮件数量和邮箱统计信息",
          },
          getInbox: {
            title: "查看收件箱",
            description: "一种便捷的方式，可以从 Gmail 中获取收件邮件。",
          },
        },
      },
      outlook: {
        title: "Outlook 连接器",
        description:
          "让您的Agent通过 Microsoft Graph API 与 Microsoft Outlook 交互——搜索邮件、阅读邮件线程、撰写草稿、发送邮件以及管理您的收件箱。请查阅相关文档。",
        multiUserWarning:
          "由于安全原因，在多用户模式下无法使用 Outlook 集成功能。请先关闭多用户模式，然后再使用此功能。",
        configuration: "Outlook 设置",
        authType: "账户类型",
        authTypeHelp:
          '选择哪些类型的 Microsoft 账户可以进行身份验证。 "所有账户" 支持个人账户和工作/学校账户。 "仅限个人账户" 仅限于个人 Microsoft 账户。 "仅限工作/学校账户" 仅限于特定 Azure AD 租户的工作/学校账户。',
        authTypeCommon: "所有账户（包括个人账户和工作/学习账户）",
        authTypeConsumers: "仅限个人 Microsoft 账户",
        authTypeOrganization: "仅限组织账户 (需要租户 ID)",
        clientId: "申请人（客户）ID",
        clientIdHelp: "您 Azure AD 应用程序注册的应用程序 ID",
        tenantId: "租户 ID",
        tenantIdHelp:
          "您的 Azure AD 应用注册的“租户 ID”。仅在组织内部身份验证时需要。",
        clientSecret: "客户端密钥",
        clientSecretHelp: "您的 Azure AD 应用程序注册的客户端机密值",
        configurationRequired:
          "请配置客户端 ID 和客户端密钥，以便启用 Outlook 相关功能。",
        authRequired:
          "首先保存您的凭据，然后通过 Microsoft 进行身份验证以完成设置。",
        authenticateWithMicrosoft: "使用 Microsoft 身份验证",
        authenticated: "已成功与 Microsoft Outlook 认证。",
        revokeAccess: "撤销权限",
        configured: "已配置",
        searchSkills: "搜索技巧...",
        noSkillsFound: "未找到与您的搜索条件匹配的技能。",
        categories: {
          search: {
            title: "搜索和阅读电子邮件",
            description: "搜索并阅读您 Outlook 收件箱中的电子邮件。",
          },
          drafts: {
            title: "草稿邮件",
            description: "创建、编辑和管理电子邮件草稿",
          },
          send: {
            title: "发送电子邮件",
            description: "立即发送新邮件或回复消息",
          },
          account: {
            title: "集成统计",
            description: "查看邮件收件箱统计数据和账户信息",
          },
        },
        skills: {
          getInbox: {
            title: "查看收件箱",
            description: "从您的 Outlook 收件箱获取最近的邮件",
          },
          search: {
            title: "搜索邮件",
            description: "使用 Microsoft 搜索语法搜索电子邮件",
          },
          readThread: {
            title: "阅读对话",
            description: "阅读完整的电子邮件对话记录",
          },
          createDraft: {
            title: "创建草稿",
            description: "创建一个新的电子邮件草稿，或回复一个已存在的邮件。",
          },
          updateDraft: {
            title: "更新草稿",
            description: "更新已有的电子邮件草稿",
          },
          listDrafts: {
            title: "草稿清单",
            description: "列出所有草稿邮件",
          },
          deleteDraft: {
            title: "删除草稿",
            description: "删除草稿邮件",
          },
          sendDraft: {
            title: "发送草稿",
            description: "发送已有的邮件草稿",
          },
          sendEmail: {
            title: "发送电子邮件",
            description: "立即发送一封新的电子邮件，或回复已存在的消息。",
          },
          getMailboxStats: {
            title: "邮件收件统计",
            description: "获取文件夹数量和邮箱统计信息",
          },
        },
      },
      googleCalendar: {
        title: "Google 日历连接器",
        description:
          "让您的Agent能够与 Google 日历互动：查看日历、获取活动、创建和更新活动，以及管理确认回复。请参考相关文档。",
        multiUserWarning:
          "由于安全原因，在多用户模式下无法使用 Google 日历集成功能。请先禁用多用户模式，然后再使用此功能。",
        configuration: "谷歌日历配置",
        deploymentId: "部署ID",
        deploymentIdHelp: "您的 Google Apps Script 网页应用的部署 ID",
        apiKey: "API 密钥",
        apiKeyHelp: "您在 Google Apps Script 部署中配置的 API 密钥。",
        configurationRequired:
          "请配置部署 ID 和 API 密钥，以启用 Google 日历功能。",
        configured: "已配置",
        searchSkills: "搜索技巧...",
        noSkillsFound: "未找到与您搜索条件匹配的技能。",
        categories: {
          calendars: {
            title: "日历",
            description: "查看和管理您的 Google 日历",
          },
          readEvents: {
            title: "查看活动",
            description: "查看和搜索日历活动",
          },
          writeEvents: {
            title: "创建和更新活动",
            description: "创建新的活动，并修改现有的活动。",
          },
          rsvp: {
            title: "请回复确认",
            description: "管理您对活动的响应状态",
          },
        },
        skills: {
          listCalendars: {
            title: "日历列表",
            description: "列出您拥有的或订阅的全部日历。",
          },
          getCalendar: {
            title: "获取日历详情",
            description: "获取有关特定日历的详细信息",
          },
          getEvent: {
            title: "获取活动",
            description: "获取有关特定活动的详细信息",
          },
          getEventsForDay: {
            title: "获取当日活动",
            description: "获取指定日期的所有活动",
          },
          getEvents: {
            title: "获取活动（日期范围）",
            description: "获取指定日期范围内的活动",
          },
          getUpcomingEvents: {
            title: "查看即将举办的活动",
            description: "使用简单的关键词，查找今天、本周或本月的活动",
          },
          quickAdd: {
            title: "快速添加活动",
            description: "从自然语言（例如“明天下午3点开会”）创建一个活动。",
          },
          createEvent: {
            title: "创建活动",
            description: "创建一个新的活动，并完全控制所有属性。",
          },
          updateEvent: {
            title: "活动更新",
            description: "更新现有的日历事件",
          },
          setMyStatus: {
            title: "设置回复状态",
            description: "接受、拒绝或表示初步接受某个活动",
          },
        },
      },
      scheduledJob: {
        title: "创建计划任务",
        description:
          "允许Agent根据聊天内容创建重复的计划任务（例如，“每天工作日的早上9点，总结我的收件箱并发送邮件给我”）。仅适用于单用户模式。",
      },
    },
    mcp: {
      title: "MCP 服务器",
      "loading-from-config": "从配置文件加载 MCP 服务器",
      "learn-more": "了解更多关于 MCP 服务器的信息。",
      "no-servers-found": "未找到任何 MCP 服务器",
      "tool-warning": "为了获得最佳性能，建议禁用不必要的工具，以节省上下文。",
      "stop-server": "停止 MCP 服务器",
      "start-server": "启动 MCP 服务器",
      "delete-server": "删除 MCP 服务器",
      "tool-count-warning":
        "这个 MCP 服务器启用了 <b> 工具，这些工具会在每次聊天中使用上下文信息。</b> 建议禁用不需要的工具，以节省上下文。<br />",
      "startup-command": "启动命令",
      command: "命令",
      arguments: "争论",
      "not-running-warning":
        "这个 MCP 服务器目前处于停止状态，可能是因为在启动时出现了错误或被手动停止。",
      "tool-call-arguments": "工具调用的参数",
      "tools-enabled": "工具已启用",
    },
    settings: {
      title: "Agent技能设置",
      "max-tool-calls": {
        title: "每个回复的最大请求次数",
        description:
          "单个Agent可以使用的最大工具数量，用于生成单个响应。 这样可以防止工具调用数量过多，从而避免无限循环。",
      },
      "intelligent-skill-selection": {
        title: "智能技能选择",
        description:
          "实现无限工具和按查询减少高达 80% 的 Token 使用量——CoreGenie 能够自动选择最合适的技能，以应对每个提示。",
        "max-tools": {
          title: "麦克斯工具",
          description:
            "可以选取的工具的最大数量，用于每个查询。我们建议将此值设置为较高的值，以便在处理大型上下文模型时。",
        },
      },
      "clarifying-questions": {
        title: "允许Agent提出进一步的疑问",
        "beta-badge": "测试版",
        description:
          "启用后，Agent可以暂停，并向您提出简短的澄清问题，以解决您的提示可能存在歧义的情况。",
        "max-per-turn": {
          title: "每回合可以提出的问题数量",
          description: "在一次调查中，销售代表可以提出多少澄清性问题？",
        },
      },
    },
  },
  recorded: {
    title: "工作区聊天历史记录",
    description: "这些是用户发送的所有聊天记录和消息，按创建日期排序。",
    export: "导出",
    table: {
      id: "编号",
      by: "发送者",
      workspace: "工作区",
      prompt: "提示词",
      response: "响应",
      at: "发送时间",
    },
  },
  customization: {
    interface: {
      title: "界面偏好设置",
      description: "设置您的 CoreGenie 界面偏好。",
    },
    branding: {
      title: "品牌与白标设置",
      description: "使用自定义品牌对白标您的 CoreGenie 实例。",
    },
    chat: {
      title: "聊天",
      description: "设置您的 CoreGenie 聊天偏好。",
      auto_submit: {
        title: "自动提交语音输入",
        description: "在静音一段时间后自动提交语音输入",
      },
      auto_speak: {
        title: "自动语音回复",
        description: "自动朗读 AI 的回复内容",
      },
      spellcheck: {
        title: "启用拼写检查",
        description: "在聊天输入框中启用或禁用拼写检查",
      },
    },
    items: {
      theme: {
        title: "主题",
        description: "选择您偏好的应用配色主题。",
      },
      "show-scrollbar": {
        title: "显示滚动条",
        description: "启用或禁用聊天窗口中的滚动条。",
      },
      "support-email": {
        title: "客服邮箱",
        description: "设置用户在需要帮助时可联系的客服邮箱地址。",
      },
      "app-name": {
        title: "名称",
        description: "设置所有用户在登录页面看到的名称。",
      },
      "display-language": {
        title: "显示语言",
        description: "选择显示 CoreGenie 界面所用的语言（若有翻译可用）。",
      },
      logo: {
        title: "品牌标志",
        description: "上传您的自定义标志以在所有页面展示。",
        add: "添加自定义标志",
        recommended: "推荐尺寸：800 x 200",
        remove: "移除",
        replace: "替换",
      },
      "browser-appearance": {
        title: "浏览器外观",
        description: "自定义应用打开时浏览器标签和标题的外观。",
        tab: {
          title: "标题",
          description: "设置应用在浏览器中打开时的自定义标签标题。",
        },
        favicon: {
          title: "网站图标",
          description: "为浏览器标签使用自定义网站图标。",
        },
      },
      "sidebar-footer": {
        title: "侧边栏底部项目",
        description: "自定义显示在侧边栏底部的项目。",
        icon: "图标",
        link: "链接",
      },
      "render-html": {
        title: "在聊天中渲染 HTML",
        description:
          "在助手回复中呈现 HTML 响应。\n这可以显著提高回复的质量，但也可能带来潜在的安全风险。",
      },
    },
  },
  api: {
    title: "API 密钥",
    description: "API 密钥允许持有者以编程方式访问和管理此 CoreGenie 实例。",
    link: "阅读 API 文档",
    generate: "生成新的 API 密钥",
    empty: "未找到 API 密钥",
    actions: "操作",
    messages: {
      error: "错误：{{error}}",
    },
    modal: {
      title: "创建新的 API 密钥",
      cancel: "取消",
      close: "关闭",
      create: "创建 API 密钥",
      helper: "创建后，API 密钥可用于以编程方式访问并配置此 CoreGenie 实例。",
      name: {
        label: "名称",
        placeholder: "生产环境集成",
        helper: "可选。使用一个易于识别的名称，以便之后识别此密钥。",
      },
    },
    row: {
      copy: "复制 API 密钥",
      copied: "已复制",
      unnamed: "--",
      deleteConfirm:
        "确定要停用此 API 密钥吗？\n停用后将无法再使用。\n\n此操作不可撤销。",
    },
    table: {
      name: "名称",
      key: "API 密钥",
      by: "创建者",
      created: "创建时间",
    },
  },
  llm: {
    title: "LLM 首选项",
    description:
      "这些是你首选的 LLM 聊天和嵌入提供商的凭据和设置。重要的是，确保这些密钥是最新的和正确的，否则 CoreGenie 将无法正常运行。",
    provider: "LLM 提供商",
    providers: {
      azure_openai: {
        azure_service_endpoint: "Azure 服务端点",
        api_key: "API 密钥",
        chat_deployment_name: "聊天部署名称",
        chat_model_token_limit: "聊天模型令牌限制",
        model_type: "模型类型",
        default: "预设",
        reasoning: "推理",
        model_type_tooltip:
          "如果您的部署使用了推理模型（例如 o1、o1-mini、o3-mini 等），请将此选项设置为“推理”。否则，您的聊天请求可能会失败。",
      },
    },
  },
  transcription: {
    title: "转录模型首选项",
    description:
      "这些是你的首选转录模型提供商的凭据和设置。重要的是这些密钥是最新且正确的，否则媒体文件和音频将无法转录。",
    provider: "转录提供商",
    "warn-start":
      "在 RAM 或 CPU 有限的计算机上使用本地耳语模型可能会在处理媒体文件时停止 CoreGenie。",
    "warn-recommend": "我们建议至少 2GB RAM 并上传 <10Mb 的文件。",
    "warn-end": "内置模型将在首次使用时自动下载。",
  },
  embedding: {
    title: "嵌入首选项",
    "desc-start":
      "当使用本身不支持嵌入引擎的 LLM 时，你可能需要额外指定用于嵌入文本的凭据。",
    "desc-end":
      "嵌入是将文本转换为矢量的过程。需要这些凭据才能将你的文件和提示转换为 CoreGenie 可以用来处理的格式。",
    provider: {
      title: "嵌入引擎提供商",
    },
  },
  text: {
    title: "文本拆分和分块首选项",
    "desc-start":
      "有时，你可能希望更改新文档在插入到矢量数据库之前拆分和分块的默认方式。",
    "desc-end": "只有在了解文本拆分的工作原理及其副作用时，才应修改此设置。",
    size: {
      title: "文本块大小",
      description: "这是单个向量中可以存在的字符的最大长度。",
      recommend: "嵌入模型的最大长度为",
    },
    overlap: {
      title: "文本块重叠",
      description: "这是在两个相邻文本块之间分块期间发生的最大字符重叠。",
    },
  },
  vector: {
    title: "向量数据库",
    description:
      "这些是 CoreGenie 实例如何运行的凭据和设置。重要的是，这些密钥是最新的和正确的。",
    provider: {
      title: "向量数据库提供商",
      description: "LanceDB 不需要任何配置。",
    },
  },
  embeddable: {
    title: "可嵌入的聊天小部件",
    description:
      "可嵌入的聊天小部件是与单个工作区绑定的面向公众的聊天界面。这些允许你构建工作区，然后你可以将其发布到全世界。",
    create: "创建嵌入式对话",
    table: {
      workspace: "工作区",
      chats: "已发送聊天",
      active: "活动域",
      created: "建立",
    },
  },
  "embed-chats": {
    title: "嵌入的聊天历史纪录",
    export: "导出",
    description: "这些是你发布的任何嵌入的所有记录的聊天和消息。",
    table: {
      embed: "嵌入",
      sender: "发送者",
      message: "消息",
      response: "响应",
      at: "发送时间",
    },
  },
  event: {
    title: "事件日志",
    description: "查看此实例上发生的所有操作和事件以进行监控。",
    clear: "清除事件日志",
    table: {
      type: "事件类型",
      user: "用户",
      occurred: "发生时间",
    },
  },
  privacy: {
    title: "隐私和数据处理",
    description: "这是你对如何处理连接的第三方提供商和CoreGenie的数据的配置。",
    anonymous: "启用匿名遥测",
  },
  connectors: {
    "search-placeholder": "搜索数据连接器",
    "no-connectors": "未找到数据连接器。",
    github: {
      name: "GitHub 仓库",
      description: "一键导入整个公共或私有的 GitHub 仓库。",
      URL: "GitHub 仓库链接",
      URL_explained: "您希望收集的 GitHub 仓库链接。",
      token: "GitHub 访问令牌",
      optional: "可选",
      token_explained: "用于避免速率限制的访问令牌。",
      token_explained_start: "如果没有 ",
      token_explained_link1: "个人访问令牌",
      token_explained_middle:
        "，由于 GitHub API 的速率限制，可能无法收集所有文件。您可以 ",
      token_explained_link2: "创建临时访问令牌",
      token_explained_end: " 来避免此问题。",
      ignores: "文件忽略列表",
      git_ignore:
        ".gitignore 格式的列表，用于在收集过程中忽略特定文件。输入后按回车保存每一项。",
      task_explained: "完成后，所有文件将可用于在文档选择器中嵌入至工作区。",
      branch: "您希望收集文件的分支。",
      branch_loading: "-- 正在加载可用分支 --",
      branch_explained: "您希望收集文件的分支。",
      token_information:
        "如果未填写 <b>GitHub 访问令牌</b>，由于 GitHub 的公共 API 限制，此数据连接器将只能收集仓库的 <b>顶层</b> 文件。",
      token_personal: "在此处使用 GitHub 账户获取免费的个人访问令牌。",
    },
    gitlab: {
      name: "GitLab 仓库",
      description: "一键导入整个公共或私有的 GitLab 仓库。",
      URL: "GitLab 仓库链接",
      URL_explained: "您希望收集的 GitLab 仓库链接。",
      token: "GitLab 访问令牌",
      optional: "可选",
      token_description: "选择要从 GitLab API 获取的额外实体。",
      token_explained_start: "如果没有 ",
      token_explained_link1: "个人访问令牌",
      token_explained_middle:
        "，由于 GitLab API 的速率限制，可能无法收集所有文件。您可以 ",
      token_explained_link2: "创建临时访问令牌",
      token_explained_end: " 来避免此问题。",
      fetch_issues: "将问题作为文档获取",
      ignores: "文件忽略列表",
      git_ignore:
        ".gitignore 格式的列表，用于在收集过程中忽略特定文件。输入后按回车保存每一项。",
      task_explained: "完成后，所有文件将可用于在文档选择器中嵌入至工作区。",
      branch: "您希望收集文件的分支",
      branch_loading: "-- 正在加载可用分支 --",
      branch_explained: "您希望收集文件的分支。",
      token_information:
        "如果未填写 <b>GitLab 访问令牌</b>，由于 GitLab 的公共 API 限制，此数据连接器将只能收集仓库的 <b>顶层</b> 文件。",
      token_personal: "在此处使用 GitLab 账户获取免费的个人访问令牌。",
    },
    youtube: {
      name: "YouTube 字幕",
      description: "通过链接导入整个 YouTube 视频的转录内容。",
      URL: "YouTube 视频链接",
      URL_explained_start:
        "输入任何 YouTube 视频的链接以获取其转录内容。视频必须启用 ",
      URL_explained_link: "隐藏字幕",
      URL_explained_end: " 功能。",
      task_explained: "完成后，转录内容将可用于在文档选择器中嵌入至工作区。",
    },
    "website-depth": {
      name: "批量链接爬虫",
      description: "爬取一个网站及其指定深度的子链接。",
      URL: "网站链接",
      URL_explained: "您希望爬取的网站链接。",
      depth: "爬取深度",
      depth_explained: "这是爬虫从起始链接向下跟踪的子链接层级数量。",
      max_pages: "最大页面数",
      max_pages_explained: "要爬取的最大链接数。",
      task_explained:
        "完成后，所有抓取的内容将可用于在文档选择器中嵌入至工作区。",
    },
    confluence: {
      name: "Confluence",
      description: "一键导入整个 Confluence 页面。",
      deployment_type: "Confluence 部署类型",
      deployment_type_explained:
        "判断您的 Confluence 实例是部署在 Atlassian 云端还是自托管。",
      base_url: "Confluence 基础链接",
      base_url_explained: "这是您 Confluence 空间的基础链接。",
      space_key: "Confluence 空间标识",
      space_key_explained:
        "您将使用的 Confluence 实例空间标识，通常以 ~ 开头。",
      username: "Confluence 用户名",
      username_explained: "您的 Confluence 用户名",
      auth_type: "Confluence 认证方式",
      auth_type_explained: "选择您希望用于访问 Confluence 页面内容的认证方式。",
      auth_type_username: "用户名和访问令牌",
      auth_type_personal: "个人访问令牌",
      token: "Confluence 访问令牌",
      token_explained_start:
        "您需要提供访问令牌用于认证。您可以在此生成访问令牌",
      token_explained_link: "此处",
      token_desc: "用于认证的访问令牌",
      pat_token: "Confluence 个人访问令牌",
      pat_token_explained: "您的 Confluence 个人访问令牌。",
      task_explained: "完成后，页面内容将可用于在文档选择器中嵌入至工作区。",
      bypass_ssl: "绕过 SSL 证书验证",
      bypass_ssl_explained:
        "启用此选项以绕过对自托管 Confluence 实例的 SSL 证书验证，特别是使用自签名证书的情况。",
    },
    manage: {
      documents: "文档",
      "data-connectors": "数据连接器",
      "desktop-only":
        "这些设置只能在桌面设备上编辑。请使用桌面访问此页面以继续操作。",
      dismiss: "关闭",
      editing: "正在编辑",
    },
    directory: {
      "my-documents": "我的文档",
      "new-folder": "新建文件夹",
      "search-document": "搜索文档",
      "no-documents": "暂无文档",
      "move-workspace": "移动到工作区",
      "delete-confirmation":
        "您确定要删除这些文件和文件夹吗？\n这将从系统中移除这些文件，并自动将其从所有关联工作区中移除。\n此操作无法撤销。",
      "removing-message":
        "正在删除 {{count}} 个文档和 {{folderCount}} 个文件夹，请稍候。",
      "move-success": "成功移动了 {{count}} 个文档。",
      no_docs: "暂无文档",
      select_all: "全选",
      deselect_all: "取消全选",
      remove_selected: "移除所选",
      save_embed: "保存并嵌入",
      "total-documents_one": "{{count}} 文件",
      "total-documents_other": "{{count}} 类型的文件",
    },
    upload: {
      "processor-offline": "文档处理器不可用",
      "processor-offline-desc":
        "当前文档处理器离线，无法上传文件。请稍后再试。",
      "click-upload": "点击上传或拖放文件",
      "file-types": "支持文本文件、CSV、电子表格、音频文件等！",
      "or-submit-link": "或提交链接",
      "placeholder-link": "https://example.com",
      fetching: "正在获取...",
      "fetch-website": "获取网站",
      "privacy-notice":
        "这些文件将被上传到此 CoreGenie 实例上的文档处理器。这些文件不会发送或共享给第三方。",
    },
    pinning: {
      what_pinning: "什么是文档固定？",
      pin_explained_block1:
        "当您在 CoreGenie 中<b>固定</b>一个文档时，我们会将整个文档内容注入到您的提示窗口中，让 LLM 能够完全理解它。",
      pin_explained_block2:
        "这在 <b>大上下文模型</b> 或关键的小文件中效果最佳。",
      pin_explained_block3:
        "如果默认情况下无法从 CoreGenie 获取满意的答案，固定文档是提高答案质量的好方法。",
      accept: "好的，知道了",
    },
    watching: {
      what_watching: "什么是监控文档？",
      watch_explained_block1:
        "当您在 CoreGenie 中<b>监控</b>一个文档时，我们会<i>自动</i>按定期间隔从其原始来源同步文档内容。系统会自动更新在所有使用该文档的工作区中的内容。",
      watch_explained_block2:
        "此功能当前仅支持在线内容，不适用于手动上传的文档。",
      watch_explained_block3_start: "您可以在 ",
      watch_explained_block3_link: "文件管理器",
      watch_explained_block3_end: " 管理视图中管理被监控的文档。",
      accept: "好的，知道了",
    },
    obsidian: {
      vault_location: "仓库位置",
      vault_description:
        "选择你的 Obsidian 仓库文件夹，以导入所有笔记及其关联。",
      selected_files: "找到 {{count}} 个 Markdown 文件",
      importing: "正在导入保险库…",
      import_vault: "导入保险库",
      processing_time: "根据你的仓库大小，这可能需要一些时间。",
      vault_warning: "为避免冲突，请确保你的 Obsidian 仓库当前未被打开。",
    },
  },
  chat_window: {
    thread_by: "由 {{username}} 创建",
    shared_thread_read_only: "共享对话 · 只读",
    shared_thread_owner: "由 {{username}} 创建。可分叉回应以继续对话。",
    unknown_user: "未知用户",
    send_message: "发送消息",
    attach_file: "向此对话附加文件",
    remove_attachment: "移除附件",
    docx_ready: "原始 DOCX 已就绪",
    original_docx: "原始 DOCX",
    docx_only: "这个助手只接受 DOCX 文件。",
    docx_upload_failed: "DOCX 上传失败。",
    drop_docx: "拖放 DOCX 到这里",
    drop_file: "拖放文件或图片到这里",
    drop_docx_description: "文件会保留原始格式，供转换助手读取图片和嵌入对象。",
    drop_file_description: "文件会附加到当前对话。",
    text_size: "更改文字大小。",
    microphone: "语音输入你的提示。",
    send: "将提示消息发送到工作区",
    attachments_processing: "附件正在处理，请稍候……",
    tts_speak_message: "TTS 播报消息",
    copy: "复制",
    regenerate: "重新",
    regenerate_response: "重新回应",
    good_response: "反应良好",
    more_actions: "更多操作",
    fork: "分叉",
    delete: "删除",
    cancel: "取消",
    edit_prompt: "编辑问题",
    edit_response: "编辑回应",
    preset_reset_description: "清除聊天纪录并开始新的聊天",
    add_new_preset: "新增预设",
    command: "指令",
    your_command: "你的指令",
    placeholder_prompt: "提示范例",
    description: "描述",
    placeholder_description: "描述范例",
    save: "保存",
    small: "小",
    normal: "一般",
    large: "大",
    workspace_llm_manager: {
      search: "搜索",
      loading_workspace_settings: "正在载入工作区设置",
      available_models: "可用模型",
      available_models_description: "可用模型说明",
      save: "保存",
      saving: "正在保存",
      missing_credentials: "缺少凭证",
      missing_credentials_description: "缺少凭证说明",
    },
    submit: "提交",
    edit_info_user: "“提交”会重新生成 AI 的回复。 “保存”只会更新您的消息。",
    edit_info_assistant: "您所做的修改将直接保存到此处。",
    see_less: "查看更多",
    see_more: "查看更多",
    tools: "Agent Tools",
    tool_approval_mode: {
      ask: "逐次询问",
      always_allow: "始终允许",
      ask_tooltip: "工具运行前需要确认。点击后将始终允许所有工具调用。",
      always_allow_tooltip: "所有工具无需确认即可运行。点击后恢复逐次确认。",
      admin_only: "只有管理员可以修改全局工具权限。",
      update_failed: "更新工具权限模式失败。",
    },
    share_chat: {
      button: "公开分享",
      sharing: "正在创建链接…",
      copied: "公开链接已复制",
      copied_short: "已复制",
      tooltip: "任何获得此链接的人都可以查看此对话",
      error: "无法创建公开聊天链接。",
      copy_error: "链接已创建，但无法复制到剪贴板。",
      public_title: "公开分享的对话",
      read_only: "只读",
      loading: "正在加载分享的对话…",
      unavailable: "此对话不可用",
      unavailable_description: "该公开链接可能无效、已过期或已不再可用。",
      shared_from: "分享自 {{workspace}}",
      empty: "此对话还没有消息。",
      user: "你",
      assistant: "助手",
      agent_activity_one: "{{count}} 条 Agent 执行记录",
      agent_activity_other: "{{count}} 条 Agent 执行记录",
      sources_one: "{{count}} 个来源",
      sources_other: "{{count}} 个来源",
      source: "来源 {{index}}",
      expand_sources: "查看引用",
      document: "工作区文档",
      references_one: "{{count}} 条引用",
      references_other: "{{count}} 条引用",
      show_excerpt: "查看摘录",
    },
    workspace_files: {
      title: "工作区文件",
      description: "与Agent共享的持久化文件",
      open: "打开工作区文件",
      close: "关闭工作区文件",
      refresh: "刷新文件",
      download: "下载文件",
      download_folder: "将文件夹下载为 ZIP",
      download_error: "无法下载此文件。",
      folder_download_error: "无法将此文件夹下载为 ZIP。",
      empty: "工作区为空",
      empty_description: "Bash、Python 或文件系统工具创建的文件将显示在这里。",
      folder: "文件夹",
      binary: "无法预览此文件，但可以下载查看。",
      too_large: "文件过大，无法预览。请下载后查看。",
      preview_truncated: "仅预览此文件的前 1 MB 内容。",
    },
    text_size_label: "字体大小",
    select_model: "选择型号",
    sources: "来源",
    document: "文件",
    similarity_match: "比赛",
    source_count_one: "{{count}} 参考",
    source_count_other: "{{count}} 相关资料",
    add_new: "添加新",
    edit: "编辑",
    publish: "出版",
    stop_generating: "停止生成回复",
    slash_commands: "快捷命令",
    quick_commands_global_hint: "所有用户共享",
    thread_processing: "此对话正在处理中",
    agent_skills: "Agent技能",
    manage_agent_skills: "管理Agent技能",
    agent_skills_disabled_in_session:
      "在活动会话期间，无法修改技能。首先使用 /exit 命令结束会话。",
    start_agent_session: "开始Agent会",
    use_agent_session_to_use_tools:
      "您可以通过在提示词的开头使用'@agent'来启动与Agent的聊天，从而使用聊天工具。",
    agent_invocation: {
      session_complete: "Agent任务已完成",
      execution_aria: "Agent 执行状态",
      activity_trace: "工作轨迹",
      context_trace: "上下文轨迹",
      tasks: "任务",
      tool_calls: "工具调用",
      needs_attention: "需要处理",
      error: "Error",
      tools_count: "{{count}} 个工具",
      sources_count: "{{count}} 个来源",
      attempt: "第 {{count}} 次尝试",
      tool_calls_count: "{{count}} 次工具调用",
      evidence_count: "{{count}} 条证据",
      cancel_task: "取消任务",
      status: {
        completed: "已完成",
        running: "处理中",
        requested: "已请求",
        started: "处理中",
        pending: "待处理",
        planned: "已规划",
        queued: "排队中",
        retrying: "正在重试",
        waiting_for_input: "等待输入",
        waiting_for_approval: "等待批准",
        failed: "失败",
        cancelled: "已取消",
        skipped: "已跳过",
        partial: "部分完成",
      },
      activity: {
        preparing: "正在准备请求",
        waiting_for_input: "等待您的回复",
        waiting_for_approval: "等待工具批准",
        restoring: "正在恢复 Agent 工作",
        agent_started: "Agent 已开始工作",
        understanding: "正在理解：{{request}}",
        determining_approach: "正在确定“{{request}}”的最佳处理方式",
        retrying_visible_response: "正在重试并生成标准可见回复",
        plan_ready: "执行计划已就绪，共 {{count}} 项任务",
        task_started: "已开始：{{task}}",
        task_completed: "已完成：{{task}}",
        task_failed: "失败：{{task}}",
        task_retrying: "正在重试：{{task}}",
        tool_started: "正在使用工具：{{tool}}",
        tool_completed: "工具调用完成：{{tool}}",
        tool_failed: "工具调用失败：{{tool}}",
        completed: "已完成",
        run_completed: "Agent 工作已完成",
        run_partial: "已完成部分结果",
        run_failed: "Agent 工作失败",
        run_failed_with_error: "Agent 工作失败：{{error}}",
        run_cancelled: "Agent 工作已取消",
      },
      context_event: {
        used: "已使用上下文",
        skill_activated: "已启用技能 · {{name}}",
        skill_updated: "技能已更新 · {{name}}",
        skill_resource_used: "已使用技能资源 · {{name}}",
        skill_script_executed: "已执行技能脚本 · {{name}}",
        memory_recalled: "已召回 {{count}} 条记忆",
        memory_updated: "记忆已更新",
        memory_deleted: "记忆已删除",
        rag_recalled: "已召回 {{count}} 个 RAG 来源",
      },
      model_wants_to_call: "模型希望调用工具：",
      approve: "允许",
      reject: "拒绝",
      always_allow: "始终允许 {{skillName}}",
      tool_call_was_approved: "已允许工具调用。",
      tool_call_was_rejected: "已拒绝工具调用。",
      clarifying_skip: "让Agent来决定",
      clarifying_submit: "提交",
      clarifying_skipped: "您可以让Agent自行决定。",
      clarifying_timeout: "未在规定时间内提交回复。",
      clarifying_answer_submitted: "回答已提交。",
      clarifying_pagination: "{{current}} 来自 {{total}}",
      clarifying_prev_aria: "上一问题",
      clarifying_next_aria: "下一个问题",
      clarifying_close_aria: "关闭并跳过",
      clarifying_other: "其他",
      clarifying_other_placeholder: "请在此处输入您的答案。",
      clarifying_custom_answer: "自定义答案",
      clarifying_custom_hint: "请在备注中告诉Agent如何处理",
      clarifying_notes: "备注",
      clarifying_notes_placeholder: "给Agent留下具体说明",
      batch_progress: "{{answered}} 在 {{total}} 提问",
      batch_skip_this: "跳过",
      batch_submit_all: "提交所有",
      batch_next: "接下来",
      answer_skipped: "[用户已跳过]",
    },
    custom_skills: "定制技能",
    agent_flows: "Agent流动",
    no_tools_found: "未找到匹配的工具",
    loading_mcp_servers: "正在加载 MCP 服务器…",
    app_integrations: "应用程序集成",
    sub_skills: "基本技能",
    memories: {
      title: "回忆",
      empty:
        "目前还没有任何记忆。当您与聊天机器人进行更多互动时，记忆会逐渐填充。",
      empty_cta: "创建一个新的记忆",
      tab_workspace: "工作空间",
      tab_global: "全球",
      toggle: {
        label: "启用个性化设置",
        description:
          "让你的助手能够回忆起与你或这个工作场所相关的事实，并在对话中使用这些信息。",
      },
      auto_extraction: {
        label: "自动回忆",
        description: "让您的助手在后台自动创建回忆。",
      },
      menu: {
        edit: "编辑",
        delete: "删除",
        move_to_global: "拓展全球市场",
        move_to_workspace: "转移到工作空间",
      },
      modal: {
        create_title: "创造回忆",
        edit_title: "编辑内存",
        create_description:
          "记忆应该用简洁明了的语句表达。例如：“用户更喜欢使用 Python 而不是 JavaScript”。",
        edit_description: "更新此存储内容的资料。",
        label: "记忆",
        placeholder: "例如，用户的姓名是 Joe，用户在 CoreGenie 上工作，等等。",
        create: "创造",
        save: "保存",
        cancel: "取消",
      },
    },
    stt_unsupported: "此浏览器不支持麦克风访问。",
    stt_mic_denied: "无法访问麦克风。请您先授予权限，然后重新尝试。",
    stt_transcription_failed: "转录失败：{{error}}",
    export: "导出聊天记录为…",
    exporting: "出口…",
  },
  profile_settings: {
    edit_account: "编辑帐户",
    profile_picture: "头像",
    remove_profile_picture: "移除头像",
    username: "用户名",
    new_password: "新密码",
    password_description: "密码长度必须至少为 8 个字符",
    cancel: "取消",
    update_account: "更新帐号",
    theme: "主题偏好",
    language: "语言偏好",
    failed_upload: "上传个人资料图片失败：{{error}}",
    upload_success: "个人资料图片已上传。",
    failed_remove: "移除个人资料图片失败：{{error}}",
    profile_updated: "个人资料已更新。",
    failed_update_user: "更新使用者失败：{{error}}",
    account: "帐户",
    support: "支援",
    system_prompt: "个人系统提示词",
    system_prompt_description:
      "应用于您的所有对话，优先级低于全局提示词和所选 Agent 的提示词。",
    system_prompt_placeholder: "添加个人偏好、工作规范或回复规则…",
    signout: "登出",
  },
  "keyboard-shortcuts": {
    title: "键盘快捷键",
    shortcuts: {
      settings: "打开设置",
      workspaceSettings: "打开目前工作区设置",
      home: "前往首页",
      workspaces: "管理工作区",
      apiKeys: "API 密钥设定",
      llmPreferences: "LLM 偏好设置",
      chatSettings: "聊天设置",
      help: "显示键盘快捷键说明",
      showLLMSelector: "显示工作区 LLM 选择器",
    },
  },
  community_hub: {
    publish: {
      system_prompt: {
        success_title: "成功！",
        success_description: "您的系统提示已发布到社区中心！",
        success_thank_you: "感谢您分享到社群！",
        view_on_hub: "在社区中心查看",
        modal_title: "发布系统提示",
        name_label: "名称",
        name_description: "这是您系统提示的显示名称。",
        name_placeholder: "我的系统提示",
        description_label: "描述",
        description_description:
          "这是您系统提示的描述。用它来描述您系统提示的目的。",
        tags_label: "标签",
        tags_description:
          "标签用于标记您的系统提示，以便于搜索。您可以添加多个标签。最多 5 个标签。每个标签最多 20 个字符。",
        tags_placeholder: "输入并按 Enter 键添加标签",
        visibility_label: "可见性",
        public_description: "公共系统提示对所有人可见。",
        private_description: "私人系统提示仅对您可见。",
        publish_button: "发布到社区中心",
        submitting: "发布中...",
        prompt_label: "提示",
        prompt_description: "这是将用于引导 LLM 的实际系统提示。",
        prompt_placeholder: "在此输入您的系统提示...",
      },
      agent_flow: {
        success_title: "成功！",
        success_description: "您的Agent流程已发布到社区中心！",
        success_thank_you: "感谢您分享到社群！",
        view_on_hub: "在社区中心查看",
        modal_title: "发布Agent流程",
        name_label: "名称",
        name_description: "这是您Agent流程的显示名称。",
        name_placeholder: "我的Agent流程",
        description_label: "描述",
        description_description:
          "这是您Agent流程的描述。用它来描述您Agent流程的目的。",
        tags_label: "标签",
        tags_description:
          "标签用于标记您的Agent流程，以便于搜索。您可以添加多个标签。最多 5 个标签。每个标签最多 20 个字符。",
        tags_placeholder: "输入并按 Enter 键添加标签",
        visibility_label: "可见性",
        submitting: "发布中...",
        submit: "发布到社区中心",
        privacy_note:
          "Agent流程始终以上传为私有，以保护任何敏感资料。您可以在发布后在社区中心更改可见性。请在发布前验证您的流程不包含任何敏感或私人信息。",
      },
      generic: {
        unauthenticated: {
          title: "需要验证",
          description:
            "在发布项目之前，您需要通过 CoreGenie 社区中心进行验证。",
          button: "连接到社区中心",
        },
      },
      slash_command: {
        success_title: "成功！",
        success_description: "您的斜线指令已发布到社区中心！",
        success_thank_you: "感谢您分享到社群！",
        view_on_hub: "在社区中心查看",
        modal_title: "发布斜线指令",
        name_label: "名称",
        name_description: "这是您斜线指令的显示名称。",
        name_placeholder: "我的斜线指令",
        description_label: "描述",
        description_description:
          "这是您斜线指令的描述。用它来描述您斜线指令的目的。",
        tags_label: "标签",
        tags_description:
          "标签用于标记您的斜线指令，以便于搜索。您可以添加多个标签。最多 5 个标签。每个标签最多 20 个字符。",
        tags_placeholder: "输入并按 Enter 键添加标签",
        visibility_label: "可见性",
        public_description: "公共斜线指令对所有人可见。",
        private_description: "私人斜线指令仅对您可见。",
        publish_button: "发布到社区中心",
        submitting: "发布中...",
        prompt_label: "提示",
        prompt_description: "这是触发斜线指令时将使用的提示。",
        prompt_placeholder: "在此输入您的提示...",
      },
    },
  },
  security: {
    title: "用户与安全",
    multiuser: {
      title: "多用户模式",
      description: "通过激活多用户模式来设置你的实例以支持你的团队。",
      enable: {
        "is-enable": "多用户模式已启用",
        enable: "启用多用户模式",
        description:
          "默认情况下，你将是唯一的管理员。作为管理员，你需要为所有新用户或管理员创建账户。不要丢失你的密码，因为只有管理员用户可以重置密码。",
        username: "管理员账户用户名",
        password: "管理员账户密码",
      },
    },
    "public-registration": {
      title: "公开注册",
      description: "允许任何能够访问此实例的人从登录页面创建普通用户账户。",
      enable: "启用公开注册",
      "access-warning": "新用户默认无权访问工作区，需要管理员或经理分配。",
      "enabled-toast": "公开注册已启用。",
      "disabled-toast": "公开注册已禁用。",
    },
    password: {
      title: "密码保护",
      description:
        "用密码保护你的CoreGenie实例。如果你忘记了密码，那么没有恢复方法，所以请确保保存这个密码。",
      "password-label": "实例密码",
    },
  },
  home: {
    welcome: "欢迎",
    chooseWorkspace: "选择一个工作区开始聊天！",
    notAssigned:
      "你目前还没有分配到任何工作区。\n请联系你的管理员请求访问一个工作区。",
    goToWorkspace: '前往 "{{workspace}}"',
  },
  telegram: {
    title: "Telegram 机器人",
    description:
      "将您的 CoreGenie 实例与 Telegram 连接起来，这样您就可以从任何设备与您的工作空间进行聊天。",
    setup: {
      step1: {
        title: "第一步：创建您的 Telegram 机器人",
        description:
          "打开 Telegram 上的 @BotFather，发送 `/newbot` 到 <code>@BotFather</code>，按照提示操作，并复制 API 令牌。",
        "open-botfather": "启动 BotFather",
        "instruction-1": "1. 打开链接或扫描二维码",
        "instruction-2":
          "2. 将 <code>/newbot</code> 发送给 <code>@BotFather</code>",
        "instruction-3": "3. 为您的机器人选择一个名称和用户名",
        "instruction-4": "4. 复制您收到的 API 令牌",
      },
      step2: {
        title: "步骤 2：连接您的机器人",
        description:
          "将您从 @BotFather 获得的 API 令牌粘贴到指定位置，并选择一个默认的工作区，以便您的机器人可以进行对话。",
        "bot-token": "机器人代币",
        connecting: "正在连接...",
        "connect-bot": "连接机器人",
      },
      security: {
        title: "推荐的安全设置",
        description: "为了进一步增强安全性，请在 @BotFather 中配置这些设置。",
        "disable-groups": "— 阻止机器人加入群组",
        "disable-inline": "— 阻止机器人被用于内联搜索",
        "obscure-username":
          "使用一个不显眼的机器人用户名，以降低其被发现的可能性。",
      },
      "toast-enter-token": "请您输入一个机器人令牌。",
      "toast-connect-failed": "未能连接机器人。",
    },
    connected: {
      status: "连接",
      "status-disconnected": "未连接—— 令牌可能已过期或无效",
      "placeholder-token": "粘贴新的机器人令牌...",
      reconnect: "重新连接",
      workspace: "工作空间",
      "bot-link": "机器人链接",
      "voice-response": "语音响应",
      disconnecting: "断开连接...",
      disconnect: "断开",
      "voice-text-only": "仅提供文字",
      "voice-mirror": "回声（当用户发送语音时，会以语音形式回复）",
      "voice-always": "请务必在回复中添加语音（发送音频）。",
      "toast-disconnect-failed": "未能成功断开机器人。",
      "toast-reconnect-failed": "机器人连接失败。",
      "toast-voice-failed": "无法更新语音模式。",
      "toast-approve-failed": "未能批准用户。",
      "toast-deny-failed": "未能拒绝用户请求。",
      "toast-revoke-failed": "未能撤销用户权限。",
    },
    users: {
      "pending-description":
        "等待验证的用户。请将此处显示的配对代码与他们在 Telegram 聊天中显示的配对代码进行匹配。",
      unknown: "未知",
    },
  },
  scheduledJobs: {
    title: "计划好的任务",
    enableNotifications: "启用浏览器通知，以便及时获取招聘结果",
    description:
      "创建可重复执行的 AI 任务，并设置执行时间表。每个任务会执行一个提示，并可以选择使用辅助工具，然后保存结果供后续审查。",
    newJob: "新工作",
    loading: "正在加载...",
    emptyTitle: "目前没有计划好的任务。",
    emptySubtitle: "创建一个，开始吧。",
    table: {
      name: "姓名",
      schedule: "时间表",
      status: "状态",
      lastRun: "最后一次",
      nextRun: "下一次尝试",
      actions: "行动",
    },
    confirmDelete: "您确定要删除这个已计划的任务吗？",
    toast: {
      deleted: "已删除工作",
      triggered: "工作已成功启动",
      triggerFailed: "未能启动任务",
      triggerSkipped: "目前，这项工作已经开始进行中。",
      killed: "工作已成功停止。",
      killFailed: "未能阻止工作",
    },
    row: {
      neverRun: "切勿奔跑",
      viewRuns: "观看记录",
      runNow: "现在就行动",
      enable: "启用",
      disable: "禁用",
      edit: "编辑",
      delete: "删除",
    },
    modal: {
      titleEdit: "编辑计划任务",
      titleNew: "新建任务",
      nameLabel: "姓名",
      namePlaceholder: "例如：每日新闻摘要",
      promptLabel: "提示",
      promptPlaceholder: "“在每次执行时执行以下指令…”",
      scheduleLabel: "时间表",
      modeBuilder: "建筑师",
      modeCustom: "定制",
      cronPlaceholder: "Cron 表达式（例如：0 9 * * *）",
      currentSchedule: "当前时间表：",
      toolsLabel: "工具（可选）",
      toolsDescription:
        "选择此任务可以使用的任何Agent工具。如果未选择任何工具，则任务将不会使用任何工具。",
      toolsSearch: "搜索",
      toolsNoResults: "没有合适的工具",
      required: "必需",
      requiredFieldsBanner: "请务必填写所有必填字段，以便创建职位。",
      cancel: "取消",
      saving: "节省...",
      updateJob: "更新职位",
      createJob: "创建工作",
      jobUpdated: "工作信息已更新",
      jobCreated: "创造了工作",
    },
    builder: {
      fallbackWarning:
        "这个表达式无法通过图形界面进行编辑。请选择“自定义”选项来保留它，或者修改下面的内容来覆盖它。",
      run: "跑步",
      frequency: {
        minute: "每分钟",
        hour: "每小时",
        day: "每日",
        week: "每周",
        month: "每月",
      },
      every: "每一个",
      minuteOne: "1 分钟",
      minuteOther: "{{count}} 分钟",
      atMinute: "在…分",
      pastEveryHour: "过去每个小时",
      at: "在",
      on: "关于",
      onDay: "在某一天",
      ofEveryMonth: "每个月",
      weekdays: {
        sun: "太阳",
        mon: "周一",
        tue: "周二",
        wed: "周三",
        thu: "星期四",
        fri: "周五",
        sat: "星期六",
      },
    },
    runHistory: {
      back: "返回工作列表",
      title: "运行历史：{{name}}",
      schedule: "时间表：",
      emptyTitle: "目前为止，这项工作还没有取得任何成果。",
      emptySubtitle: "立即运行任务，并查看其结果。",
      runNow: "立即行动",
      table: {
        status: "状态",
        started: "开始",
        duration: "时长",
        error: "错误",
      },
      stopJob: "停止工作",
    },
    runDetail: {
      loading: "正在加载运行详情...",
      notFound: "未找到。",
      back: "返回",
      unknownJob: "未知的职位",
      runHeading: "{{name}} — 运行 #{{id}}",
      duration: "时长：{{value}}",
      creating: "创作...",
      threadFailed: "未能创建线程",
      sections: {
        prompt: "提示",
        error: "错误",
        thinking: "想法 ({{count}})",
        toolCalls: "工具调用 ({{count}})",
        files: "文件 ({{count}})",
        response: "回应",
        metrics: "指标",
      },
      metrics: {
        promptTokens: "提示词：",
        completionTokens: "完成标记：",
      },
      stopJob: "停止工作",
      killing: "停止...",
      continueInThread: "继续聊天",
    },
    toolCall: {
      arguments: "论点：",
      showResult: "显示结果",
      hideResult: "隐藏结果",
    },
    file: {
      unknown: "未知的文件",
      download: "下载",
      downloadFailed: "未能下载文件",
      types: {
        powerpoint: "幻灯片",
        pdf: "PDF 格式文档",
        word: "文档",
        spreadsheet: "电子表格",
        generic: "文件",
      },
    },
    status: {
      completed: "已完成",
      failed: "失败",
      timed_out: "超时",
      running: "跑步",
      queued: "排队",
    },
  },
  "model-router": {
    title: "型号路由器",
    description:
      "模型路由器允许您定义规则，根据特定条件自动将聊天消息路由到不同的LLM提供商和模型。",
    table: {
      name: "姓名",
      fallback: "备用方案",
      rules: "规则",
      workspaces: "工作空间",
    },
    "no-routers": "目前还没有发布任何型号的路由器。",
    "empty-description": "目前还没有配置任何路由器模型。请创建一个来开始。",
    "new-router-button": "新的路由器",
    "delete-confirm":
      '您确定要删除路由器 "{{name}}" 吗？\n这将删除所有其规则，并断开使用该路由器的所有工作空间。\n\n此操作是不可逆的。',
    "toast-deleted": "路由器已删除",
    "toast-delete-failed": "未能删除路由器：{{error}}",
    "new-router": {
      title: "创建新的路由器模型",
      name: "姓名",
      "name-placeholder": "例如：成本优化器",
      description: "描述",
      "description-placeholder": "可选描述",
      "fallback-label": "主要服务提供方及模型",
      "fallback-description":
        "当没有任何路由规则匹配时，也会使用。此外，还用于评估由大型语言模型（LLM）分类的规则。",
      "cooldown-label": "缓存冷却时间 (秒)",
      "cooldown-help":
        "路由决策在重新评估规则之前，被缓存的时间长度。将设置为 0 以禁用缓存。",
      "name-required": "姓名是必填项。",
      "fallback-required": "需要提供主要服务提供方和模型。",
      cancel: "取消",
      create: "创建路由器",
    },
    "edit-router": {
      "back-to-routers": "返回：路由器模型",
      title: "编辑路由器：{{name}}",
      save: "保存更改",
      "toast-update-failed": "无法更新路由器",
    },
    rules: {
      title: "路由规则",
      "title-with-name": "路由规则：{{name}}",
      description:
        "明确规定哪些聊天消息应该发送给哪些提供商和模型，以及发送的方式。",
      "add-rule": "添加规则",
      "delete-confirm": '删除规则 "{{title}}"?',
      "toast-delete-failed": "未能删除规则",
      "toast-reorder-failed": "未能重新应用规则",
      "no-rules": "目前还没有任何规定。",
      "empty-description":
        "添加一条规则，以便将聊天消息路由到特定的提供商和模型。",
      "new-rule-button": "新的规定",
      "calculated-section-label": "计算规则——按照优先级顺序进行评估",
      "llm-section-label":
        "LLM 规则——如果没有任何规则计算结果与给定条件匹配，则作为批量进行评估",
      "llm-rule-body": "匹配“{{description}}”后，然后将结果路由到“<route>”",
      "calculated-no-conditions":
        "无任何条件——前往<route>，{{route}}，</route>",
      "calculated-single-condition":
        '如果满足条件：<prop> {{property}}，</prop> {{comparator}}，<val>"{{value}}"，</val>，则将路由到 <route>{{route}}</route>',
      "calculated-multi-condition":
        "如果满足<cond>的条件，则将路径设置为<route>",
      "comparator-contains": "包含",
      "comparator-matches": "比赛",
      "comparator-between": "之间",
      "badge-llm": "大型语言模型",
      "badge-calculated": "计算得出",
      "aria-drag-to-reorder": "拖动以重新排序",
      "aria-edit-rule": "编辑规则",
      "aria-delete-rule": "删除规则",
      "quantifier-any": "任何",
      "quantifier-all": "全部",
    },
    "rule-form": {
      "title-label": "标题",
      "rule-type": "规则类型",
      "property-label": "房产",
      "property-select": "选择",
      "comparator-label": "比较器",
      "comparator-select": "选择",
      "value-label": "价值",
      "add-condition": "添加条件",
      "remove-condition": "移除条件",
      "conditions-incomplete": "条件{{index}}不完整——请填写属性、比较器和值。",
      "match-description-label": "比赛描述",
      "match-description-placeholder":
        "例如，用户可能咨询有关法律、合同或合规等问题。",
      "match-description-help":
        "描述您希望该规则适用的情况。您的LLM会评估这些情况，以确定是否应该使用该规则。",
      "route-to-label": "向服务提供商的路径及模型",
      "route-to-description": "当此规则匹配时，请使用此提供商/模型。",
      cancel: "取消",
      saving: "节省...",
      "update-rule": "更新规则",
      "create-rule": "创建规则",
      "title-required": "标题是必需的",
      "toast-save-failed": "未能保存规则",
      "type-calculated-label": "计算得出",
      "type-calculated-description":
        "根据消息的属性（如内容、标记数量或发送时间）进行匹配。",
      "type-llm-label": "大型语言模型分类",
      "type-llm-description":
        "使用大型语言模型（LLM），根据您提供的描述对消息进行分类。",
      "prop-prompt-content": "提示内容",
      "prop-token-count": "对话标记数量",
      "prop-message-count": "对话消息数量",
      "prop-current-hour": "当前时间 (0-23)",
      "prop-has-image": "是否包含图片",
      "cmp-contains": "包含",
      "cmp-matches-regex": "匹配（正则表达式）",
      "cmp-equals": "等于",
      "cmp-not-equals": "不等于",
      "cmp-greater-than": "大于",
      "cmp-greater-than-or-equal": "大于或等于",
      "cmp-less-than": "少于",
      "cmp-less-than-or-equal": "小于或等于",
      "cmp-between": "包括...在内",
      "placeholder-between-hour": "例如：9:00-17:00 (上午9点到下午5点)",
      "placeholder-between-numeric": "例如：10, 50",
      "placeholder-hour": "例如：18 (0-23)",
      "placeholder-message-count": "例如：10",
      "placeholder-numeric": "例如：4000",
      "placeholder-contains": "例如：代码、Python、Rust",
      "placeholder-matches": "例如：/\\bpython\\b/i",
      "placeholder-default": "例如：代码",
      "help-contains":
        "用逗号分隔的列表 — 如果提示包含任何这些值（不区分大小写），则匹配。",
      "help-matches":
        "正则表达式模式。 使用 `/pattern/flags` 选项来指定大小写敏感性（默认情况下，大小写不敏感）。",
      "bool-true": "真实",
      "bool-false": "错误",
    },
    "provider-picker": {
      "select-provider": "选择供应商",
      "setup-required": "（需要进行设置）",
      "loading-models": "正在加载模型...",
      "select-model": "选择型号",
      "enter-model": "请输入型号名称",
      "select-provider-first": "首先选择一个服务提供商。",
      "configure-to-continue": "配置 {{name}} 以继续运行",
      "configure-provider": "配置 {{name}}",
      "setup-credentials": "输入必要的凭据，以便使用 {{name}} 作为路由目标。",
      cancel: "取消",
      "save-settings": "保存设置",
      "toast-save-failed": "未能保存设置：{{error}}",
    },
    "router-selection": {
      "loading-routers": "正在加载自定义路由器...",
      "no-routers-prefix-settings": "目前尚未配置任何路由器型号。",
      "no-routers-prefix-workspace": "没有配置任何型号的路由器。",
      "no-routers-link": "在模型路由器设置中创建一项",
      "model-router-label": "型号路由器",
      "select-router": "选择一个路由器",
      "select-description": "选择用于此工作区域的路由器。",
      "no-routers-chat":
        "没有配置任何路由器。请在“设置 > AI 提供方 > 路由器”中创建一个。",
      "rule-count": "({{count}} 的规则)",
    },
    metrics: {
      "model-router-default": "型号路由器",
    },
    chat: {
      "select-router-error": "选择一个路由器",
      "invalid-model": "无效的模型选择",
      "routed-to": "已发送至 <route>{{model}}</route>",
      "routed-to-rule":
        "通过<route>、{{model}}、</route>，到达<rule>、{{ruleTitle}}、</rule>",
    },
  },
};

export default TRANSLATIONS;
