// import Image from 'next/image';

export default async function Home() {
  const list = await new Promise<number[]>((resolve) =>
    setTimeout(() => {
      resolve([1, 2, 3]);
    }, 1000),
  );

  return (
    <div>
      <main>{list.join(', ')}</main>
      <footer>Footer</footer>
    </div>
  );
}
