import React from "react";
import { Image } from "sourceog";

export const metadata = {
  title: "SourceOG Home",
  description: "Hyper-production home page."
};

export default function HomePage(): React.JSX.Element {
  return (
    <section>
      <h1>SourceOG</h1>
      <p>App-router-first framework with SSR, SSG, ISR, and platform-grade contracts.</p>
      <Image
        alt="SourceOG"
        src="https://dummyimage.com/640x360/111827/ffffff&text=SourceOG"
        width={640}
        height={360}
      />
    </section>
  );
}
