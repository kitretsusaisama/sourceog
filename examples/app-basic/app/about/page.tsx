import React from "react";
import { ClientIsland } from "sourceog/client-island";
import ClientCounter from "./ClientCounter";
import { recordAboutVisit } from "./actions";

export const metadata = {
  title: "About SourceOG"
};

export default function AboutPage(): React.JSX.Element {
  void recordAboutVisit;

  return (
    <section>
      <h1>About</h1>
      <p>This route is prerenderable and demonstrates the app router.</p>
      <ClientIsland component={ClientCounter} moduleId="./ClientCounter" />
    </section>
  );
}
