import { useContext } from "react";
import { PfpContext } from "../PfpContext";

export default function usePfp() {
  const context = useContext(PfpContext);
  if (!context) throw new Error("usePfp requires PfpProvider");
  return context;
}
