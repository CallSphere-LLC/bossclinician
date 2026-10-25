import { ceuTerms } from "@/content/kajabiPagesLegal";
import { KajabiLegalDocument } from "./KajabiLegalDocument";
import { MobileLegalIndex } from "./MobileLegalIndex";

/** /ceu-terms-boss-clinician — reproduced from bossclinician.com/ceu-terms-boss-clinician (copy in content/kajabiPagesLegal.ts). */
export default function CeuTerms() {
  return (
    <div className="flex flex-col [&>section:first-of-type]:order-1 [&>section:last-of-type]:order-3 xl:block">
      <MobileLegalIndex clauses={ceuTerms.clauses} label="Continuing Education Program Policies" />
      <KajabiLegalDocument doc={ceuTerms} />
    </div>
  );
}
