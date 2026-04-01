import React from "react";

export const revalidate = 60;
export const cacheTags = ["blog", "content"];

export async function generateStaticParams(): Promise<Array<{ slug: string }>> {
  return [
    { slug: "hello-sourceog" },
    { slug: "framework-kernel" }
  ];
}

export function generateMetadata(props: { params: { slug: string } }): { title: string; description: string } {
  return {
    title: `Blog: ${props.params.slug}`,
    description: `Article for ${props.params.slug}`
  };
}

export default function BlogPage(props: { params: { slug: string } }): React.JSX.Element {
  return (
    <article>
      <h1>{props.params.slug}</h1>
      <p>This page uses static params plus ISR metadata.</p>
    </article>
  );
}
