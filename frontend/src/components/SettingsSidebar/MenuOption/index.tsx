import React, { useEffect, useState } from "react";
import { CaretRight } from "@phosphor-icons/react";
import { Link, useLocation } from "react-router-dom";
import { type StoredUser, safeJsonParse } from "@/utils/request";
import { isPathMatch } from "@/utils/paths";
import useScrollActiveItemIntoView from "@/hooks/useScrollActiveItemIntoView";

interface OptionProps {
  btnText: string;
  icon?: React.ReactNode;
  href?: string;
  childOptions?: OptionProps[];
  flex?: boolean;
  user?: StoredUser | null;
  roles?: string[];
  hidden?: boolean;
  isChild?: boolean;
  exact?: boolean;
}
function visible(
  { roles = [], flex = false, hidden = false }: OptionProps,
  user: StoredUser | null
) {
  return !hidden && (user ? roles.includes(user.role ?? "") : flex);
}
export default function MenuOption({
  btnText,
  icon,
  href,
  childOptions = [],
  flex = false,
  user = null,
  roles = [],
  hidden = false,
  isChild = false,
  exact = false,
}: OptionProps) {
  const storageKey = generateStorageKey({ key: btnText });
  const location = useLocation();
  const hasChildren = childOptions.length > 0;
  const hasVisibleChildren = childOptions.some((child) => visible(child, user));
  const { isExpanded, setIsExpanded } = useIsExpanded({
    storageKey,
    hasVisibleChildren,
    childOptions,
    location: location.pathname,
  });

  const isActive = hasChildren
    ? (!isExpanded &&
        childOptions.some((child) =>
          matchesPath(child.href, location.pathname, child.exact)
        )) ||
      location.pathname === href
    : matchesPath(href, location.pathname, exact);

  const { ref } = useScrollActiveItemIntoView<HTMLAnchorElement>({
    isActive,
    behavior: "instant",
    block: "center",
  });

  if (hidden) return null;

  if ((isChild || !hasChildren) && !visible({ btnText, flex, roles }, user))
    return null;
  if (hasChildren && !isChild && !hasVisibleChildren) return null;

  const handleClick = (e: React.MouseEvent) => {
    if (hasChildren) {
      e.preventDefault();
      const newExpandedState = !isExpanded;
      setIsExpanded(newExpandedState);
      localStorage.setItem(storageKey, JSON.stringify(newExpandedState));
    }
  };

  return (
    <div>
      <div
        className={`
          flex items-center justify-between w-full
          transition-colors duration-150
          rounded-lg
          ${
            isActive
              ? "bg-theme-sidebar-subitem-selected text-theme-text-primary"
              : "hover:bg-theme-sidebar-subitem-hover"
          }
        `}
      >
        <Link
          ref={ref}
          to={href ?? location.pathname}
          replace
          className={`flex min-w-0 flex-grow items-center px-3 h-10 font-medium text-theme-text-secondary transition-colors hover:text-theme-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-theme-button-primary ${
            isChild ? "pl-8" : ""
          }`}
          onClick={hasChildren ? handleClick : undefined}
        >
          {icon}
          <p
            className={`${
              isChild ? "text-[13px]" : "text-sm"
            } truncate leading-5 ml-2 ${
              isActive
                ? "text-theme-text-primary font-medium"
                : "text-theme-text-secondary"
            } ${!icon && !isChild ? "pl-5" : ""}`}
          >
            {btnText}
          </p>
        </Link>
        {hasChildren && (
          <button
            type="button"
            aria-label={btnText}
            onClick={handleClick}
            className="mr-1 flex h-8 w-8 items-center justify-center rounded-md text-theme-text-secondary transition-colors hover:bg-theme-sidebar-subitem-hover hover:text-theme-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-button-primary"
          >
            <CaretRight
              size={16}
              weight="bold"
              // color={isExpanded ? "#000000" : "var(--theme-sidebar-subitem-icon)"}
              className={`transition-transform duration-150 ${
                isExpanded ? "rotate-90" : ""
              }`}
            />
          </button>
        )}
      </div>
      {isExpanded && hasChildren && (
        <div className="mt-1 w-full space-y-1">
          {childOptions.map((childOption, index) => (
            <MenuOption
              key={index}
              {...childOption} // flex and roles go here.
              user={user}
              isChild={true}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function useIsExpanded({
  storageKey = "",
  hasVisibleChildren = false,
  childOptions = [],
  location,
}: {
  storageKey: string;
  hasVisibleChildren: boolean;
  childOptions: OptionProps[];
  location: string;
}) {
  const [isExpanded, setIsExpanded] = useState(() => {
    if (hasVisibleChildren) {
      const storedValue = localStorage.getItem(storageKey);
      if (storedValue !== null) {
        return safeJsonParse<unknown>(storedValue, false) === true;
      }
      return childOptions.some((child) =>
        matchesPath(child.href, location, child.exact)
      );
    }
    return false;
  });

  useEffect(() => {
    if (hasVisibleChildren) {
      const shouldExpand = childOptions.some((child) =>
        matchesPath(child.href, location, child.exact)
      );
      if (shouldExpand && !isExpanded) {
        setIsExpanded(true);
        localStorage.setItem(storageKey, JSON.stringify(true));
      }
    }
  }, [location]);

  return { isExpanded, setIsExpanded };
}

function matchesPath(
  href: string | undefined,
  pathname: string,
  exact = false
) {
  if (!href || !pathname) return false;
  return exact ? pathname === href : isPathMatch(href, pathname);
}

function generateStorageKey({ key = "" }) {
  const _key = key.replace(/\s+/g, "_").toLowerCase();
  return `anything_llm_menu_${_key}_expanded`;
}
