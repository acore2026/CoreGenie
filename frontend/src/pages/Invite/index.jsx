import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowRight, CircleNotch, UserPlus } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { FullScreenLoader } from "@/components/Preloader";
import Invite from "@/models/invite";
import NewUserModal from "./NewUserModal";
import ModalWrapper from "@/components/ModalWrapper";
import { userFromStorage } from "@/utils/request";
import paths from "@/utils/paths";

export default function InvitePage() {
  const { code } = useParams();
  const [result, setResult] = useState({
    status: "loading",
    message: null,
    invite: null,
  });

  useEffect(() => {
    async function checkInvite() {
      if (!code) {
        setResult({
          status: "invalid",
          message: "No invite code provided.",
        });
        return;
      }
      const { invite, error } = await Invite.checkInvite(code);
      setResult({
        status: invite ? "valid" : "invalid",
        message: error,
        invite,
      });
    }
    checkInvite();
  }, [code]);

  if (result.status === "loading") {
    return (
      <div className="w-screen h-screen overflow-hidden bg-theme-bg-container flex">
        <FullScreenLoader />
      </div>
    );
  }

  if (result.status === "invalid") {
    return (
      <div className="w-screen h-screen overflow-hidden bg-theme-bg-container flex items-center justify-center">
        <p className="text-red-400 text-lg">{result.message}</p>
      </div>
    );
  }

  return (
    <div className="w-screen h-screen overflow-hidden bg-theme-bg-container flex items-center justify-center">
      <ModalWrapper isOpen={true}>
        {userFromStorage() ? (
          <ExistingUserJoin invite={result.invite} />
        ) : (
          <NewUserModal invite={result.invite} />
        )}
      </ModalWrapper>
    </div>
  );
}

function ExistingUserJoin({ invite }) {
  const { t } = useTranslation();
  const { code } = useParams();
  const user = userFromStorage();
  const workspace = invite?.workspaces?.[0] || null;
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState(null);

  async function joinWorkspace() {
    if (joining) return;
    setJoining(true);
    setError(null);
    const result = await Invite.joinWorkspace(code);
    if (result.success) {
      const destination = result.workspaces?.[0] || workspace;
      window.location = destination?.slug
        ? paths.workspace.chat(destination.slug)
        : paths.home();
      return;
    }
    setError(result.error || t("workspace-invite.join-failed"));
    setJoining(false);
  }

  const loginTarget = `/login?nt=1&redirectTo=${encodeURIComponent(
    `/accept-invite/${code}`
  )}`;

  return (
    <section className="relative mx-4 w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-zinc-950 shadow-[0_28px_90px_rgba(0,0,0,0.6)] light:border-slate-200 light:bg-white">
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-sky-400 via-cyan-300 to-emerald-300" />
      <div className="px-7 pb-7 pt-8 text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-400/15 text-sky-300 light:bg-sky-100 light:text-sky-700">
          <UserPlus size={28} weight="fill" />
        </span>
        <p className="mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-sky-300 light:text-sky-700">
          {t("workspace-invite.invited-to")}
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-theme-text-primary">
          {workspace?.name || t("workspace-invite.a-workspace")}
        </h1>
        <p className="mt-3 text-sm leading-6 text-theme-text-secondary">
          {t("workspace-invite.join-as", { username: user?.username })}
        </p>

        {error && (
          <div className="mt-5 rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-left text-sm text-red-300 light:text-red-700">
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={joinWorkspace}
          disabled={joining}
          className="mt-6 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-zinc-950 transition-colors hover:bg-zinc-200 disabled:cursor-wait disabled:opacity-70 light:bg-slate-900 light:text-white light:hover:bg-slate-700"
        >
          {joining ? (
            <CircleNotch size={18} className="animate-spin" />
          ) : (
            <ArrowRight size={18} weight="bold" />
          )}
          {joining ? t("workspace-invite.joining") : t("workspace-invite.join")}
        </button>

        {error && (
          <Link
            to={loginTarget}
            className="mt-4 inline-block text-sm text-theme-text-secondary underline decoration-white/20 underline-offset-4 hover:text-theme-text-primary"
          >
            {t("workspace-invite.sign-in-again")}
          </Link>
        )}
      </div>
    </section>
  );
}
