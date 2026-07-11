import RecordPlayer, { type Album } from "./components/RecordPlayer";

const albums: Album[] = [];

export default function Home() {
  const CURRENT_YEAR = new Date().getFullYear();
  return (
    <main
      className="start"
      style={{
        flexDirection: "column",
      }}
    >
      <br />
      <p
        style={{
          fontSize: 10,
        }}
      >
        Vinny Records. © {CURRENT_YEAR} Vince P. All rights reserved.
      </p>
      <RecordPlayer albums={albums} />

      <br />
    </main>
  );
}
