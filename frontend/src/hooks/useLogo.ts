import { useContext } from "react";
import { LogoContext } from "../LogoContext";

export default function useLogo() {
  const context = useContext(LogoContext);
  if (!context) throw new Error("useLogo requires LogoProvider");
  return context;
}
