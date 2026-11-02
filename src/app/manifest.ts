import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Darpan",
    short_name: "Darpan",
    description: "A talking magic mirror that coaches your skincare and makeup.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#F8F5FF",
    theme_color: "#F8F5FF",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
