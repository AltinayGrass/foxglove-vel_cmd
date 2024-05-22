import {
  PanelExtensionContext,
  RenderState,
  Topic,
  SettingsTreeAction,
  SettingsTreeNode,
  SettingsTreeNodes,
} from "@foxglove/studio";

import { set } from "lodash";
import nipplejs, { JoystickManagerOptions, Position } from "nipplejs";
import React, { useCallback, useLayoutEffect, useEffect, useState } from "react";
import ReactDOM from "react-dom";

import { useMountEffect } from "./hooks";
import { std_msg__Float64MultiArray } from "./types";

type Config = {
  topic: string;
  messageSchema: string | undefined;
  publishRate: number;
  maxLinearSpeed: number;
  maxAngularSpeed: number;
};
const VEL_CMD_SCHEMA_ROS_1 = "std_msgs/Float64MultiArray";
const VEL_CMD_SCHEMA_ROS_2 = "std_msgs/msg/Float64MultiArray";
const ALL_VEL_CMD_SCHEMAS = [VEL_CMD_SCHEMA_ROS_1, VEL_CMD_SCHEMA_ROS_2];

function buildSettingsTree(config: Config, topics: readonly Topic[]): SettingsTreeNodes {
  const general: SettingsTreeNode = {
    label: "General",
    fields: {
      topic: {
        label: "Topic",
        input: "autocomplete",
        value: config.topic,
        items: topics.map((t) => t.name),
        error: !topics.find(({ name }) => name === config.topic)
          ? "Topic does not exist"
          : undefined,
      },
      messageSchema: {
        input: "string",
        label: "Message Schema",
        value: config.messageSchema,
        error: !config.messageSchema ? "Message schema not found" : undefined,
        readonly: true,
      },
      publishRate: { label: "Publish rate", input: "number", value: config.publishRate },
      maxLinearSpeed: { label: "Max linear", input: "number", value: config.maxLinearSpeed },
      maxAngularSpeed: { label: "Max angular", input: "number", value: config.maxAngularSpeed },
    },
  };

  return { general };
}

function createFloat64MultiArray(data: Float64Array): std_msg__Float64MultiArray {
  return {
    layout: {
      dim: {
        label: "",
        size: 0,
        stride: 0,
      },
      data_offset: 0,
    },
    data,
  };
}
function ExamplePanel({ context }: { context: PanelExtensionContext }): JSX.Element {
  const [config, setConfig] = useState<Config>(() => {
    const partialConfig = context.initialState as Config;
    const { publishRate = 5, maxLinearSpeed = 1, maxAngularSpeed = 1, ...rest } = partialConfig;

    return {
      ...rest,
      publishRate,
      maxLinearSpeed,
      maxAngularSpeed,
    };
  });

  const [topics, setTopics] = useState<ReadonlyArray<Topic>>([]);
  const [currentTopic, setCurrentTopic] = useState<Topic | void>(() => {
    const initialState = context.initialState as Config;
    return initialState.topic && initialState.messageSchema
      ? {
          name: initialState.topic,
          schemaName: initialState.messageSchema,
          datatype: initialState.messageSchema,
        }
      : undefined;
  });
  const currentTopicRef = React.useRef<Topic | void>();
  currentTopicRef.current = currentTopic;

  const nextCmdPt = React.useRef<[number, number] | null>(null);
  const nextCmdIntervalId = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const nextCmdIntervalSlowDownId = React.useRef<ReturnType<typeof setInterval> | null>(null);

  const [renderDone, setRenderDone] = useState<(() => void) | undefined>();
  const nippleManagerRef = React.useRef<nipplejs.JoystickManager | null>(null);

  const { saveState } = context;

  const [colorScheme, setColorScheme] = useState<"dark" | "light">("light");

  const startPointRef = React.useRef<Position>({ x: 0, y: 0 });
  const lastPointRef = React.useRef<Position>({ x: 0, y: 0 });

  const advertiseTopic = useCallback(
    (topic: Topic) => {
      if (currentTopicRef.current?.name) {
        context.unadvertise?.(currentTopicRef.current?.name);
      }
      context.advertise?.(topic.name, topic?.schemaName);
    },
    [context],
  );

  useMountEffect(() => {
    if (currentTopic) {
      advertiseTopic(currentTopic);
    }

    // Clean up
    return () => {
      if (nextCmdIntervalId.current) {
        clearInterval(nextCmdIntervalId.current);
      }
      if (nextCmdIntervalSlowDownId.current) {
        clearInterval(nextCmdIntervalSlowDownId.current);
      }
    };
  });

  const settingsActionHandler = useCallback(
    (action: SettingsTreeAction) => {
      if (action.action !== "update") {
        return;
      }

      setConfig((previous) => {
        const newConfig = { ...previous };
        set(newConfig, action.payload.path.slice(1), action.payload.value);

        if (newConfig.publishRate < 1) {
          newConfig.publishRate = 1;
        }
        if (newConfig.maxLinearSpeed < 0) {
          newConfig.maxLinearSpeed = 0;
        }
        if (newConfig.maxAngularSpeed < 0) {
          newConfig.maxAngularSpeed = 0;
        }

        // eslint-disable-next-line no-warning-comments
        // TODO: Error checking here to see if topic actually exists?
        const newTopic = topics.find((topic) => topic.name === newConfig.topic);
        setCurrentTopic(newTopic);
        if (newTopic && newTopic.name !== currentTopicRef.current?.name) {
          newConfig.messageSchema = newTopic?.schemaName;
          newConfig.messageSchema = newTopic?.schemaName;
        }

        return newConfig;
      });
    },
    [topics],
  );

  const createAndPublishMessage = useCallback(
    (linearSpeed: number, angularSpeed: number) => {
      const linearVec = createFloat64MultiArray(new Float64Array([linearSpeed]));
      const angularVec = createFloat64MultiArray(new Float64Array([angularSpeed]));

      let message: std_msg__Float64MultiArray;
      const schemaName = currentTopicRef.current?.schemaName ?? "";
      if (ALL_VEL_CMD_SCHEMAS.includes(schemaName)) {
        message = angularVec;
        message = linearVec;
      } else {
        console.error("Unknown message schema");
        return;
      }
      if (currentTopicRef.current?.name) {
        context.publish?.(currentTopicRef.current.name, message);
      }
    },
    [context],
  );
  const cmdSlowDown = React.useCallback(() => {
    const startPoint = startPointRef.current;
    const lastPoint = lastPointRef.current;

    lastPoint.x = lastPoint.x * 0.9 + startPoint.x * 0.1;
    lastPoint.y = lastPoint.y * 0.9 + startPoint.y * 0.1;

    const x = startPoint.x - lastPoint.x;
    const y = startPoint.y - lastPoint.y;
    // X
    const resultX = (x / 100) * 1.5707;
    // Y
    const resultY = (y / 100) * 1.0;
    createAndPublishMessage(resultY * config.maxLinearSpeed, resultX * config.maxAngularSpeed);

    if (Math.abs(resultY) < 0.0005 && nextCmdIntervalSlowDownId.current) {
      clearInterval(nextCmdIntervalSlowDownId.current);
      nextCmdIntervalSlowDownId.current = null;
    }
  }, [config.maxAngularSpeed, config.maxLinearSpeed, context, createAndPublishMessage]);

  const cmdMove = React.useCallback(() => {
    if (!nextCmdPt.current) {
      return;
    }
    const [lx, az] = nextCmdPt.current;

    createAndPublishMessage(lx * config.maxLinearSpeed, az * config.maxAngularSpeed);
  }, [config.maxAngularSpeed, config.maxLinearSpeed, context, createAndPublishMessage]);

  const initNipple = React.useCallback(() => {
    // Destroy any previous nipple elements
    if (nippleManagerRef.current) {
      nippleManagerRef.current.destroy();
    }

    // nipple
    const options: JoystickManagerOptions = {
      zone: document.getElementById("nipple_zone") as HTMLDivElement,
      color: colorScheme === "light" ? "black" : "white",
      size: 200,
      restOpacity: 0.8,
      mode: "static",
      dynamicPage: true,
      position: { left: "50%", top: "50%" },
    };
    // nipple_manager
    nippleManagerRef.current = nipplejs.create(options);

    // nipple_start
    nippleManagerRef.current.on("start", (_, data) => {
      startPointRef.current = data.position;
      nextCmdIntervalId.current = setInterval(cmdMove, 1000 / config.publishRate);
      if (nextCmdIntervalSlowDownId.current) {
        clearInterval(nextCmdIntervalSlowDownId.current);
      }
    });
    // nipple_move
    nippleManagerRef.current.on("move", (_, data) => {
      const x = startPointRef.current.x - data.position.x;
      const y = startPointRef.current.y - data.position.y;
      // X
      const resultX = (x / 100) * 1.5707;
      // Y
      const resultY = (y / 100) * 1.0;
      nextCmdPt.current = [resultY, resultX];
      lastPointRef.current = data.position;
    });

    // nipple_end
    nippleManagerRef.current.on("end", () => {
      // 停车

      if (nextCmdIntervalId.current) {
        clearInterval(nextCmdIntervalId.current);
        nextCmdIntervalId.current = null;
      }
      nextCmdIntervalSlowDownId.current = setInterval(cmdSlowDown, 1000 / config.publishRate);
    });
  }, [colorScheme, cmdMove, config.publishRate, cmdSlowDown]);

  useEffect(() => {
    initNipple();
  }, [initNipple]);

  useEffect(() => {
    const tree = buildSettingsTree(config, topics);
    context.updatePanelSettingsEditor({
      actionHandler: settingsActionHandler,
      nodes: tree,
    });
    saveState(config);
  }, [config, context, saveState, settingsActionHandler, topics]);

  // We use a layout effect to setup render handling for our panel. We also setup some topic subscriptions.

  useLayoutEffect(() => {
    // The render handler is run by the broader studio system during playback when your panel
    // needs to render because the fields it is watching have changed. How you handle rendering depends on your framework.
    // You can only setup one render handler - usually early on in setting up your panel.
    //
    // Without a render handler your panel will never receive updates.
    //
    // The render handler could be invoked as often as 60hz during playback if fields are changing often.

    context.onRender = (renderState: RenderState, done: () => void) => {
      // render functions receive a _done_ callback. You MUST call this callback to indicate your panel has finished rendering.
      // Your panel will not receive another render callback until _done_ is called from a prior render. If your panel is not done
      // rendering before the next render call, studio shows a notification to the user that your panel is delayed.

      // Set the done callback into a state variable to trigger a re-render.
      setRenderDone(() => done);

      // We may have new topics - since we are also watching for messages in the current frame, topics may not have changed
      // It is up to you to determine the correct action when state has not changed.

      setTopics(
        renderState.topics?.filter(({ schemaName }) => ALL_VEL_CMD_SCHEMAS.includes(schemaName)) ??
          [],
      );
      if (renderState.colorScheme) {
        setColorScheme(renderState.colorScheme);
      }
    };

    // After adding a render handler, you must indicate which fields from RenderState will trigger updates.
    // If you do not watch any fields then your panel will never render since the panel context will assume you do not want any updates.

    // tell the panel context that we care about any update to the _topic_ field of RenderState
    context.watch("topics");
    context.watch("colorScheme");
  }, [context, colorScheme, initNipple]);

  // invoke the done callback once the render is complete
  useEffect(() => {
    renderDone?.();
  }, [renderDone]);

  return (
    <div style={{ padding: "1rem" }}>
      <div id="nipple_zone"></div>
    </div>
  );
}

export function initExamplePanel(context: PanelExtensionContext): void {
  ReactDOM.render(<ExamplePanel context={context} />, context.panelElement);
}
