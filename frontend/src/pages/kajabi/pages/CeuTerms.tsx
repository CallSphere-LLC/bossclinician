import { ceuTerms } from "@/content/kajabiPagesLegal";
import { KajabiLegalDocument } from "./KajabiLegalDocument";

/** /ceu-terms-boss-clinician — reproduced from bossclinician.com/ceu-terms-boss-clinician (copy in content/kajabiPagesLegal.ts). */
export default function CeuTerms() {
  return <KajabiLegalDocument doc={ceuTerms} />;
}
