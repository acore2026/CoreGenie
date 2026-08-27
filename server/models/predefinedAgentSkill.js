const prisma = require("../utils/prisma");

const PredefinedAgentSkill = {
  all: async function () {
    try {
      return await prisma.predefined_agent_skills.findMany({
        orderBy: [{ name: "asc" }, { id: "asc" }],
      });
    } catch (error) {
      console.error(error.message);
      return [];
    }
  },

  whereIds: async function (ids = []) {
    const normalized = [...new Set(ids.map(Number).filter(Number.isInteger))];
    if (!normalized.length) return [];
    try {
      const skills = await prisma.predefined_agent_skills.findMany({
        where: { id: { in: normalized } },
      });
      return normalized
        .map((id) => skills.find((skill) => skill.id === id))
        .filter(Boolean);
    } catch (error) {
      console.error(error.message);
      return [];
    }
  },

  create: async function ({ name, description = "", instructions }) {
    try {
      return await prisma.predefined_agent_skills.create({
        data: { name, description, instructions },
      });
    } catch (error) {
      console.error(error.message);
      return null;
    }
  },

  update: async function (id, data = {}) {
    try {
      return await prisma.predefined_agent_skills.update({
        where: { id: Number(id) },
        data: { ...data, lastUpdatedAt: new Date() },
      });
    } catch (error) {
      console.error(error.message);
      return null;
    }
  },

  delete: async function (id) {
    try {
      await prisma.predefined_agent_skills.delete({
        where: { id: Number(id) },
      });
      return true;
    } catch (error) {
      console.error(error.message);
      return false;
    }
  },
};

module.exports = { PredefinedAgentSkill };
