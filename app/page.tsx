import RecordPlayer, { type Album } from "./components/RecordPlayer";

const albums: Album[] = [];

export default function Home() {
  return (
    <main className="start">
      <RecordPlayer albums={albums} />
    </main>
  );
}
