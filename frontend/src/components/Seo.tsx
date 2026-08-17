import { useEffect } from "react";

interface SeoProps {
  title: string;
  description?: string;
}

export function Seo({ title, description }: SeoProps) {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = title;

    let metaDescription: HTMLMetaElement | null = null;
    let prevDescription: string | null = null;

    if (description) {
      metaDescription = document.querySelector('meta[name="description"]');
      if (metaDescription) {
        prevDescription = metaDescription.getAttribute("content");
        metaDescription.setAttribute("content", description);
      }
    }

    return () => {
      document.title = prevTitle;
      if (metaDescription && prevDescription !== null) {
        metaDescription.setAttribute("content", prevDescription);
      }
    };
  }, [title, description]);

  return null;
}
