export function TavilySearchOptions({ settings }) {
  return (
    <>
      <p className="text-sm text-white/60 my-2">
        可在{" "}
        <a
          href="https://tavily.com/"
          target="_blank"
          rel="noreferrer"
          className="text-blue-300 underline"
        >
          Tavily 官网
        </a>{" "}
        申请 API Key。
      </p>
      <div className="flex gap-x-4">
        <div className="flex flex-col w-60">
          <label className="text-white text-sm font-semibold block mb-3">
            API Key
          </label>
          <input
            type="password"
            name="env::AgentTavilyApiKey"
            className="border-none bg-theme-settings-input-bg text-white placeholder:text-theme-settings-input-placeholder text-sm rounded-lg focus:outline-primary-button active:outline-primary-button outline-none block w-full p-2.5"
            placeholder="Tavily API Key"
            defaultValue={settings?.AgentTavilyApiKey ? "*".repeat(20) : ""}
            required={true}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      </div>
    </>
  );
}

export function ExaSearchOptions({ settings }) {
  return (
    <>
      <p className="text-sm text-white/60 my-2">
        可在{" "}
        <a
          href="https://exa.ai"
          target="_blank"
          rel="noreferrer"
          className="text-blue-300 underline"
        >
          Exa 官网
        </a>{" "}
        申请 API Key。
      </p>
      <div className="flex gap-x-4">
        <div className="flex flex-col w-60">
          <label className="text-white text-sm font-semibold block mb-3">
            API Key
          </label>
          <input
            type="password"
            name="env::AgentExaApiKey"
            className="border-none bg-theme-settings-input-bg text-white placeholder:text-theme-settings-input-placeholder text-sm rounded-lg focus:outline-primary-button active:outline-primary-button outline-none block w-full p-2.5"
            placeholder="Exa API Key"
            defaultValue={settings?.AgentExaApiKey ? "*".repeat(20) : ""}
            required={true}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      </div>
    </>
  );
}

export function BaiduSearchOptions({ settings }) {
  return (
    <>
      <p className="text-sm text-white/60 my-2">
        可在{" "}
        <a
          href="https://cloud.baidu.com/doc/qianfan-api/s/Wmbq4z7e5"
          target="_blank"
          rel="noreferrer"
          className="text-blue-300 underline"
        >
          百度智能云千帆平台
        </a>{" "}
        获取 API Key。
      </p>
      <div className="flex gap-x-4">
        <div className="flex flex-col w-60">
          <label className="text-white text-sm font-semibold block mb-3">
            API Key
          </label>
          <input
            type="password"
            name="env::AgentBaiduSearchApiKey"
            className="border-none bg-theme-settings-input-bg text-white placeholder:text-theme-settings-input-placeholder text-sm rounded-lg focus:outline-primary-button active:outline-primary-button outline-none block w-full p-2.5"
            placeholder="百度千帆搜索 API Key"
            defaultValue={
              settings?.AgentBaiduSearchApiKey ? "*".repeat(20) : ""
            }
            required={true}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      </div>
    </>
  );
}

export function SearXNGOptions({ settings }) {
  return (
    <div className="flex gap-x-4">
      <div className="flex flex-col w-60">
        <label className="text-white text-sm font-semibold block mb-3">
          SearXNG 接口地址
        </label>
        <input
          type="url"
          name="env::AgentSearXNGApiUrl"
          className="border-none bg-theme-settings-input-bg text-white placeholder:text-theme-settings-input-placeholder text-sm rounded-lg focus:outline-primary-button active:outline-primary-button outline-none block w-full p-2.5"
          placeholder="https://your-searxng-instance/search"
          defaultValue={settings?.AgentSearXNGApiUrl}
          required={true}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
    </div>
  );
}

export function DuckDuckGoOptions() {
  return (
    <p className="text-sm text-white/60 my-2">
      DuckDuckGo 无需额外配置即可直接使用。
    </p>
  );
}
