import fs from 'fs/promises';
// import Image from 'next/image';

export default async function Home() {
  const file = await fs.readFile('./tools.json', 'utf-8');
  const parsed = JSON.parse(file);

  return (
    <div>
      <main>
        <pre>{JSON.stringify(parsed, null, 2)}</pre>
      </main>
      <footer>Footer</footer>
    </div>
  );
}
