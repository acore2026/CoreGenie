import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Tab } from "@headlessui/react";
import {
  ArrowRight,
  ArrowDown,
  Check,
  FileText,
  Paperclip,
  ArrowUpRight,
} from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import useUser from "@/hooks/useUser";
import { PublicBrand } from "@/components/PublicLayout";
import paths from "@/utils/paths";
import System from "@/models/system";
import "./landing.css";

const examples = ["proposal", "roadmap", "research"];

export default function Landing() {
  const { t } = useTranslation();
  const store = useUser();
  const [registration, setRegistration] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    System.publicRegistrationStatus().then((result) => {
      if (active) setRegistration(result.enabled === true);
    });
    return () => {
      active = false;
    };
  }, []);
  const signedIn = Boolean(store.authToken);
  const primary = signedIn
    ? paths.home()
    : registration
      ? paths.register()
      : paths.login();
  const action = signedIn
    ? "public_page.enter"
    : registration
      ? "home_design.start"
      : "public_page.login_start";

  return (
    <div className="public-page editorial-home">
      <header className="public-header">
        <PublicBrand />
        <nav aria-label={t("public_page.navigation")}>
          <a href="#work-example" className="public-text-link home-nav-example">
            {t("home_design.see_example")}
          </a>
          <Link
            to={signedIn ? paths.home() : paths.login()}
            className="home-nav-login"
          >
            {t(signedIn ? "public_page.enter" : "public_page.login")}
            <ArrowUpRight size={15} />
          </Link>
        </nav>
      </header>
      <main>
        <section className="home-intro" aria-labelledby="home-title">
          <p className="home-kicker">
            <span aria-hidden="true" />
            {t("home_design.eyebrow")}
          </p>
          <h1 id="home-title">
            {t("home_design.title")}
            <br />
            <span>{t("home_design.title_end")}</span>
          </h1>
          <p className="home-deck">{t("home_design.description")}</p>
          <div className="home-actions">
            <Link to={primary} className="home-primary">
              {t(action)}
              <ArrowRight size={18} />
            </Link>
            <a href="#work-example" className="home-secondary">
              {t("home_design.see_how")}
              <ArrowDown size={16} />
            </a>
          </div>
        </section>
        <section
          className="home-product"
          id="work-example"
          aria-label={t("home_design.examples")}
        >
          <Tab.Group>
            <div className="home-product-heading">
              <Tab.List
                className="home-tabs"
                aria-label={t("home_design.examples")}
              >
                {examples.map((key) => (
                  <Tab
                    key={key}
                    className={({ selected }) =>
                      `home-tab ${selected ? "is-selected" : ""}`
                    }
                  >
                    {t(`home_design.${key}.label`)}
                  </Tab>
                ))}
              </Tab.List>
              <span className="home-example-tag">
                {t("home_design.example_tag")}
              </span>
            </div>
            <Tab.Panels>
              {examples.map((key) => (
                <Tab.Panel key={key} className="home-demo-panel">
                  <div className="home-demo-request">
                    <div className="home-section-label">
                      <span>01</span>
                      {t("home_design.request")}
                    </div>
                    <p className="home-question">
                      {t(`home_design.${key}.prompt`)}
                    </p>
                    <div className="home-attachment">
                      <Paperclip size={15} />
                      {t(`home_design.${key}.source`)}
                    </div>
                    <div className="home-agent-line">
                      <img src="/coregenie-mark.svg" alt="" />
                      <div>
                        <strong>CoreGenie</strong>
                        <span>{t("home_design.agent_hint")}</span>
                      </div>
                    </div>
                    <ol className="home-demo-steps">
                      {["read", "compare", "write"].map((step) => (
                        <li key={step}>
                          <Check size={14} />
                          {t(`home_design.${key}.${step}`)}
                        </li>
                      ))}
                    </ol>
                  </div>
                  <div className="home-demo-result">
                    <div className="home-section-label">
                      <span>02</span>
                      {t("home_design.result")}
                      <FileText size={16} />
                    </div>
                    <article className="home-paper">
                      <div className="home-paper-top">
                        <span>{t("home_design.report")}</span>
                        <span>01 / 01</span>
                      </div>
                      <h2>{t(`home_design.${key}.report`)}</h2>
                      <p className="home-paper-summary">
                        {t(`home_design.${key}.summary`)}
                      </p>
                      <div className="home-report-table">
                        {["row1", "row2", "row3"].map((row, index) => (
                          <div key={row}>
                            <span>0{index + 1}</span>
                            <strong>{t(`home_design.${key}.${row}`)}</strong>
                            <Check size={13} />
                          </div>
                        ))}
                      </div>
                      <div className="home-paper-foot">
                        <span>{t("home_design.references")}</span>
                        <span>{t(`home_design.${key}.reference`)}</span>
                      </div>
                    </article>
                  </div>
                </Tab.Panel>
              ))}
            </Tab.Panels>
          </Tab.Group>
          <div className="home-product-caption">
            <span>{t("home_design.example_note")}</span>
            <span>CoreGenie</span>
          </div>
        </section>
        <section
          className="home-principles"
          aria-label={t("home_design.features")}
        >
          {["sources", "progress", "files"].map((key, index) => (
            <article key={key}>
              <span className="home-principle-number">0{index + 1}</span>
              <div>
                <h2>{t(`home_design.${key}.title`)}</h2>
                <p>{t(`home_design.${key}.description`)}</p>
              </div>
            </article>
          ))}
        </section>
      </main>
      <footer className="home-footer">
        <span>CoreGenie</span>
        <p>{t("home_design.footer")}</p>
        <Link to={primary}>
          {t(action)}
          <ArrowUpRight size={15} />
        </Link>
      </footer>
    </div>
  );
}
