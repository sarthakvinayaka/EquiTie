import { getDatabase, listInvestors } from "@/lib/data/loader";
import InvestorPortal from "@/components/InvestorPortal";

// Default investor shown on first load — INV001 is Idris Olawale (High tech, 9 deals, great showcase)
const DEFAULT_INVESTOR_ID = "INV001";

export default function Home() {
  const db = getDatabase();
  const investors = listInvestors(db);

  return (
    <InvestorPortal
      investors={investors}
      defaultInvestorId={DEFAULT_INVESTOR_ID}
    />
  );
}
