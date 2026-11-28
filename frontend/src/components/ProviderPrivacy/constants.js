import CoreGenieIcon from "@/media/logo/coregenie-mark.svg";
import OpenAiLogo from "@/media/llmprovider/openai.png";
import GenericOpenAiLogo from "@/media/llmprovider/generic-openai.png";
import LanceDbLogo from "@/media/vectordbs/lancedb.png";
import PGVectorLogo from "@/media/vectordbs/pgvector.png";

const LLM_PROVIDER_PRIVACY_MAP = {
  openai: {
    name: "OpenAI",
    policyUrl: "https://openai.com/policies/privacy-policy/",
    logo: OpenAiLogo,
  },
  "generic-openai": {
    name: "Generic OpenAI 兼容接口",
    description: ["数据按你配置的兼容接口服务商协议处理。"],
    logo: GenericOpenAiLogo,
  },
};

const VECTOR_DB_PROVIDER_PRIVACY_MAP = {
  lancedb: {
    name: "LanceDB",
    description: ["向量和文档片段保存在当前实例本地存储中。"],
    logo: LanceDbLogo,
  },
  pgvector: {
    name: "PGVector",
    description: ["向量和文档片段保存在你配置的 PostgreSQL 数据库中。"],
    logo: PGVectorLogo,
  },
};

const EMBEDDING_ENGINE_PROVIDER_PRIVACY_MAP = {
  native: {
    name: "内置本地嵌入模型",
    description: ["文档文本在当前实例本地完成向量化，不发送到外部服务。"],
    logo: CoreGenieIcon,
  },
  openai: {
    name: "OpenAI",
    policyUrl: "https://openai.com/policies/privacy-policy/",
    logo: OpenAiLogo,
  },
  "generic-openai": {
    name: "Generic OpenAI 兼容接口",
    description: ["数据按你配置的兼容接口服务商协议处理。"],
    logo: GenericOpenAiLogo,
  },
};

export const PROVIDER_PRIVACY_MAP = {
  llm: LLM_PROVIDER_PRIVACY_MAP,
  embeddingEngine: EMBEDDING_ENGINE_PROVIDER_PRIVACY_MAP,
  vectorDb: VECTOR_DB_PROVIDER_PRIVACY_MAP,
};
