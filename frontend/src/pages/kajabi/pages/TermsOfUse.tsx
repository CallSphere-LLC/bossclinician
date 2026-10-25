import { termsOfUse } from "@/content/kajabiPagesLegal";
import { KajabiLegalDocument } from "./KajabiLegalDocument";
import { MobileLegalIndex } from "./MobileLegalIndex";

/** /terms-of-use — reproduced from bossclinician.com/terms-of-use (copy in content/kajabiPagesLegal.ts). */
export default function TermsOfUse() {
  return (
    <div className="flex flex-col [&>section:first-of-type]:order-1 [&>section:last-of-type]:order-3 xl:block">
      <MobileLegalIndex clauses={termsOfUse.clauses} label="Terms of Use" />
      <KajabiLegalDocument doc={termsOfUse} />
    </div>
  );
}
