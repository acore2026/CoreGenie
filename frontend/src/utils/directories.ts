import { formatDateTime, type DateInput } from "@/utils/dateTime";

export function formatDate(dateString: string | number | Date) {
  const date = isNaN(new Date(dateString).getTime())
    ? new Date()
    : new Date(dateString);
  const options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "short",
    day: "numeric",
  };
  const formattedDate = date.toLocaleDateString("en-US", options);
  return formattedDate;
}

export function formatDateTimeAsMoment(dateString: DateInput, format = "LLL") {
  return formatDateTime(dateString, format);
}

export function getFileExtension(path?: string | null) {
  const hasExtension = path?.includes(".");
  if (!hasExtension) return "FILE";
  const extension = path?.split(".")?.slice(-1)?.[0];
  return extension?.toUpperCase() || "FILE";
}

export function middleTruncate(str: string, n: number) {
  const fileExtensionPattern = /([^.]*)$/;
  const extensionMatch = str.includes(".") && str.match(fileExtensionPattern);

  if (str.length <= n) return str;

  if (extensionMatch && extensionMatch[1]) {
    const extension = extensionMatch[1];
    const nameWithoutExtension = str.replace(fileExtensionPattern, "");
    const truncationPoint = Math.max(0, n - extension.length - 4);
    const truncatedName =
      nameWithoutExtension.substr(0, truncationPoint) +
      "..." +
      nameWithoutExtension.slice(-4);

    return truncatedName + extension;
  } else {
    return str.length > n ? str.substr(0, n - 8) + "..." + str.slice(-4) : str;
  }
}
