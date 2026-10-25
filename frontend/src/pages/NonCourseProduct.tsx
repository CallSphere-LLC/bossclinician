import { useParams } from "react-router";
import { Seo } from "@/components/Seo";
import { LuxePageHero } from "@/components/luxe/LuxePageHero";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { Section, SectionTitle } from "@/components/luxe/Section";
import { Container } from "@/components/ui/Container";
import { usePageData } from "@/hooks/usePageData";
import { api } from "@/lib/api";
import { ssrKeys } from "@/ssr/keys";
import { salesButtons, parseSalesPage } from "@/components/course/salesPage";
import type { CourseDetailResponse } from "@/components/course/CoursePriceLabel";

/** The existing offer still owns checkout; this page only changes the product's presentation. */
export default function NonCourseProduct() {
  const { slug = "" } = useParams();
  const service = slug === "directory-makeover-audit";
  const expected = service ? "directory-makeover-audit" : "rate-negotiation-letter-template";
  const page = usePageData<CourseDetailResponse>(
    ssrKeys.courseDetail(expected),
    () => api.courseDetail(expected) as Promise<CourseDetailResponse>,
    { revalidateForMembers: true },
  );
  if (slug !== expected || page.status === "missing") {
    return <><Seo title="Product not found ? Boss Clinician" noindex httpStatus={404} />
      <Section><Container>We couldn't find that product.</Container></Section></>;
  }
  if (page.status !== "ready") {
    return <><Seo title="Loading ? Boss Clinician" noindex httpStatus={503} />
      <Section><Container>Loading product details?</Container></Section></>;
  }
  const product = page.data;
  const salesPage = parseSalesPage((product as { salesPage?: unknown }).salesPage);
  const buttons = salesButtons(product.offers);
  const highlights = salesPage?.hero.highlights ?? product.features;
  return <>
    <Seo title={`${product.title} ? Boss Clinician`} description={product.description} />
    <LuxePageHero
      eyebrow={service ? "Service" : "Download"}
      title={product.title}
      lede={product.subtitle || product.description}
      tone="violet"
      actions={product.owned
        ? <LuxeButton to="/library" variant="foil">Open in your library</LuxeButton>
        : buttons[0] && <LuxeButton to={buttons[0].to} variant="foil">{buttons[0].label}</LuxeButton>}
      aside={product.image && <img src={product.image} alt="" className="max-h-80 w-full rounded-2xl object-cover" />}
    />
    <Section surface="base" space="md">
      <Container className="max-w-4xl">
        <SectionTitle title={service ? "How the audit works" : "What you get"} body={product.description} />
        {Array.isArray(highlights) && <ul className="mt-8 grid gap-3">
          {highlights.filter((value): value is string => typeof value === "string").map((value) =>
            <li key={value} className="rounded-xl border border-hairline px-5 py-4 text-ink">{value}</li>)}
        </ul>}
        {service && <p className="mt-8 text-ink">After purchase, check your email for the intake form. Send your profile links and preferences so Yvette can begin your personalized audit.</p>}
        <div className="mt-8 flex flex-wrap gap-3">
          {product.owned
            ? <LuxeButton to="/library" variant="foil">Open in your library</LuxeButton>
            : buttons.map((button) => <LuxeButton key={button.key} to={button.to} variant={button.primary ? "foil" : "glass"}>{button.label}</LuxeButton>)}
        </div>
        {!product.owned && !buttons.length && <p className="mt-4 text-ink">This product is not available for checkout right now.</p>}
      </Container>
    </Section>
  </>;
}
