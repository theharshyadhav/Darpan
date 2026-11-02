import type { SVGProps } from "react";

/** Small line icons, one stroke weight, drawn for this app. Decorative unless a label is given by the button. */

type P = SVGProps<SVGSVGElement>;

function Base({ children, ...p }: P) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...p}
    >
      {children}
    </svg>
  );
}

export const MicIcon = (p: P) => (
  <Base {...p}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </Base>
);
export const MicOffIcon = (p: P) => (
  <Base {...p}>
    <path d="M4 4l16 16" />
    <path d="M9 9v2a3 3 0 0 0 5 2.2M15 9.5V6a3 3 0 0 0-5.6-1.5" />
    <path d="M5 11a7 7 0 0 0 11 5.7M19 11a7 7 0 0 1-.6 2.8M12 18v3" />
  </Base>
);
export const MoonIcon = (p: P) => (
  <Base {...p}>
    <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z" />
  </Base>
);
export const GearIcon = (p: P) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" />
  </Base>
);
export const CameraIcon = (p: P) => (
  <Base {...p}>
    <path d="M4 8h3l1.5-2h7L17 8h3v11H4Z" />
    <circle cx="12" cy="13" r="3.5" />
  </Base>
);
export const UploadIcon = (p: P) => (
  <Base {...p}>
    <path d="M12 16V4M7 9l5-5 5 5M4 20h16" />
  </Base>
);
export const CheckIcon = (p: P) => (
  <Base {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Base>
);
export const CloseIcon = (p: P) => (
  <Base {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Base>
);
export const SendIcon = (p: P) => (
  <Base {...p}>
    <path d="M4 12 20 4l-4 16-4.5-6.5Z" />
    <path d="m11.5 13.5 4-5" />
  </Base>
);
export const SparkIcon = (p: P) => (
  <Base {...p}>
    <path d="M12 3c.8 4.6 2.4 6.2 7 7-4.6.8-6.2 2.4-7 7-.8-4.6-2.4-6.2-7-7 4.6-.8 6.2-2.4 7-7Z" />
  </Base>
);
export const ListIcon = (p: P) => (
  <Base {...p}>
    <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />
  </Base>
);
export const RingsIcon = (p: P) => (
  <Base {...p}>
    <circle cx="8" cy="12" r="4.5" />
    <circle cx="16" cy="12" r="4.5" />
  </Base>
);
export const ShareIcon = (p: P) => (
  <Base {...p}>
    <path d="M12 15V4M8 8l4-4 4 4M5 13v6h14v-6" />
  </Base>
);
export const HomeIcon = (p: P) => (
  <Base {...p}>
    <path d="M4 11 12 4l8 7v9h-5v-6H9v6H4Z" />
  </Base>
);
export const FaceIcon = (p: P) => (
  <Base {...p}>
    <path d="M12 3c4 0 6 3 6 7 0 5-3 10-6 10s-6-5-6-10c0-4 2-7 6-7Z" />
    <path d="M9.5 10.5h.01M14.5 10.5h.01M10 15c1.2 1 2.8 1 4 0" />
  </Base>
);
export const DropIcon = (p: P) => (
  <Base {...p}>
    <path d="M12 3s6 6.2 6 10.5A6 6 0 0 1 6 13.5C6 9.2 12 3 12 3Z" />
  </Base>
);
export const PaletteIcon = (p: P) => (
  <Base {...p}>
    <path d="M12 3a9 9 0 1 0 0 18c1.4 0 2-.9 2-1.8 0-1.2-1-1.4-1-2.5 0-.9.7-1.7 1.7-1.7H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3Z" />
    <path d="M7.5 11h.01M10 7.5h.01M14.5 7.5h.01" />
  </Base>
);
export const BookIcon = (p: P) => (
  <Base {...p}>
    <path d="M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3Z" />
    <path d="M5 17a3 3 0 0 1 3-3h10" />
  </Base>
);
export const BottleIcon = (p: P) => (
  <Base {...p}>
    <path d="M10 3h4v3l1.5 2.5V20a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1V8.5L10 6Z" />
    <path d="M8.5 13h7" />
  </Base>
);
export const ScaleIcon = (p: P) => (
  <Base {...p}>
    <path d="M12 4v16M6 20h12M5 8h14M5 8l-2.5 6a3.5 3.5 0 0 0 5 0Zm14 0-2.5 6a3.5 3.5 0 0 0 5 0Z" />
  </Base>
);
