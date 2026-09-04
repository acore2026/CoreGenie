const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const settings = [
    { label: "multi_user_mode", value: "false" },
    { label: "logo_filename", value: "anything-llm.png" },
    { label: "memory_enabled", value: "true" },
  ];

  const feedbackReasons = [
    { code: "incorrect", label: "内容不准确", sortOrder: 10 },
    { code: "incomplete", label: "没有完整完成要求", sortOrder: 20 },
    { code: "source-issue", label: "资料或引用有问题", sortOrder: 30 },
    { code: "tool-failure", label: "工具、下载或文件处理失败", sortOrder: 40 },
    { code: "format-unusable", label: "格式或文件不好用", sortOrder: 50 },
    { code: "too-slow", label: "等待时间太长", sortOrder: 60 },
    { code: "other", label: "其他", sortOrder: 70 },
  ];

  for (let setting of settings) {
    const existing = await prisma.system_settings.findUnique({
      where: { label: setting.label },
    });

    // Only create the setting if it doesn't already exist
    if (!existing) {
      await prisma.system_settings.create({
        data: setting,
      });
    }
  }

  for (const reason of feedbackReasons) {
    await prisma.agent_feedback_reasons.upsert({
      where: { code: reason.code },
      update: { label: reason.label, sortOrder: reason.sortOrder },
      create: reason,
    });
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
