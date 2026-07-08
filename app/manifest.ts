import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Evolution OS",
    short_name: "Evolution",
    description: "Your personal real-estate AI assistant.",
    start_url: "/",
    display: "standalone",
    background_color: "#05060f",
    theme_color: "#05060f",
    orientation: "portrait",
    icons: [
      {
        src: "/icon.svg",
        sizes: "192x192 512x512 any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
