import GithubOptions from "./Connectors/Github";

export default function DataConnectors() {
  return (
    <div className="upload-modal w-full overflow-y-auto p-4">
      <GithubOptions />
    </div>
  );
}
