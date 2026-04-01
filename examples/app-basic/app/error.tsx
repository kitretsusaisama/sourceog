import React from "react";

export default function ErrorPage(props: { error: Error }): React.JSX.Element {
  return (
    <section>
      <h1>500</h1>
      <pre>{props.error.message}</pre>
    </section>
  );
}
