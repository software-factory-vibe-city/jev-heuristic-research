export const mazeCases = [
  {
    id: "corridor",
    title: "01 / Corridor",
    description: "Sanity check: follow a single bend to the goal.",
    ascii: [
      "#########",
      "#S......#",
      "#######.#",
      "#G......#",
      "#########",
    ].join("\n"),
  },
  {
    id: "detour",
    title: "02 / Away from the goal",
    description: "A nearby goal sits behind a wall. Progress initially requires moving away from it.",
    ascii: [
      "#########",
      "#S#....G#",
      "#.#.###.#",
      "#...#...#",
      "#########",
    ].join("\n"),
  },
  {
    id: "fork",
    title: "03 / Tempting dead end",
    description: "The rightward corridor points toward the goal but ends blindly; the lower route connects.",
    ascii: [
      "###########",
      "#S......#G#",
      "#.#######.#",
      "#.........#",
      "###########",
    ].join("\n"),
  },
] as const;
