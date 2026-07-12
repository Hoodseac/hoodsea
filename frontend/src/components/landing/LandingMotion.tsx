/**
 * Calm, static ocean ground behind the landing: an ivory paper base washed with
 * green from the top and a faint tide glow from the bottom. No motion here on
 * purpose; the ambient life lives in the hero backdrop. Light theme only.
 */
export function LandingMotion() {
  return (
    <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
      {/* Ivory paper ground */}
      <div className="absolute inset-0" style={{ background: "#F4F7EC" }} />
      {/* Soft green wash from the top */}
      <div
        className="absolute inset-x-0 top-0 h-[90vh]"
        style={{ background: "linear-gradient(to bottom, #E9F6DF, rgba(244,247,236,0))" }}
      />
      {/* Faint tide glow rising from the bottom */}
      <div
        className="absolute inset-x-0 bottom-0 h-[55vh]"
        style={{ background: "linear-gradient(to top, rgba(0,200,5,0.06), rgba(244,247,236,0))" }}
      />
    </div>
  );
}
