import { termsOfUse } from "@/content/kajabiPagesLegal";
import { KajabiLegalDocument } from "./KajabiLegalDocument";

/** /terms-of-use — reproduced from bossclinician.com/terms-of-use (copy in content/kajabiPagesLegal.ts). */
export default function TermsOfUse() {
  return <KajabiLegalDocument doc={termsOfUse} />;
}
