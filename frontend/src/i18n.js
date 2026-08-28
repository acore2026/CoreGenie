import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import Mandarin from "./locales/zh/common.js";

const resources = {
  zh: {
    common: Mandarin,
  },
};

i18next
  .use(initReactI18next) // Initialize i18n for React
  .init({
    lng: "zh",
    fallbackLng: "zh",
    supportedLngs: ["zh"],
    debug: import.meta.env.DEV,
    defaultNS: "common",
    resources,
    lowerCaseLng: true,
    interpolation: {
      escapeValue: false,
    },
  });

export default i18next;
