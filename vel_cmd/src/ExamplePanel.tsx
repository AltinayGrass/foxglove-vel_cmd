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

const VEL_CMD_SCHEMA_ROS_1 = "std_msgs/Float64MultiArray";
const VEL_CMD_SCHEMA_ROS_2 = "std_msgs/msg/Float64MultiArray";

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

  let startPoint: Position;
  let lastPoint: Position;

  const cmdSlowDown = React.useCallback(() => {

    lastPoint.x=(lastPoint.x + startPoint.x)/2.0;
    lastPoint.y=(lastPoint.y + startPoint.y)/2.0;
  
    const x = 0;//startPoint.x - lastPoint.x;
    const y = 0;//startPoint.y - lastPoint.y;
    // X 
    const resultX = (x / 100) * 1.5707;
    // Y 
    const resultY = (y / 100) * 1.0;


    const linearSpeed = new Float64Array(1);
    linearSpeed[0] = resultY * config.maxLinearSpeed;
    const angularSpeed = new Float64Array(1);
    angularSpeed[0] = resultX * config.maxAngularSpeed;
   
    const linearVec: std_msg__Float64MultiArray = {
      layout: {
            dim:{
            label: "",
            size: 0,
            stride: 0
      },
      data_offset: 0
      },
      data: linearSpeed };

    const angularVec: std_msg__Float64MultiArray = {
      layout: {
            dim:{
            label: "",
            size: 0,
            stride: 0
      },
      data_offset: 0
      },
      data: angularSpeed
    };
    let message: std_msg__Float64MultiArray;
    const schemaName = currentTopicRef.current?.schemaName ?? "";
    if ([VEL_CMD_SCHEMA_ROS_1, VEL_CMD_SCHEMA_ROS_2].includes(schemaName)) {
      message = angularVec;
      message = linearVec;
    } else {
      console.error("Unknown message schema");
      return;
    }
    if (currentTopicRef.current?.name) {
      context.publish?.(currentTopicRef.current.name, message);
    }
    if (Math.abs(resultY)<0.05 && nextCmdIntervalSlowDownId.current)
    {
      clearInterval(nextCmdIntervalSlowDownId.current);
      nextCmdIntervalSlowDownId.current = null;
    }
  }, [config, context]);


  const cmdMove = React.useCallback(() => {
    if (!nextCmdPt.current) {
      return;
    }
    const [lx, az] = nextCmdPt.current;
    const linearSpeed = new Float64Array(1);
    linearSpeed[0] = lx * config.maxLinearSpeed;
    const angularSpeed = new Float64Array(1);
    angularSpeed[0] = az * config.maxAngularSpeed;
   

    const linearVec: std_msg__Float64MultiArray = {
      layout: {
            dim:{
            label: "",
            size: 0,
            stride: 0
      },
      data_offset: 0
      },
      data: linearSpeed };

    const angularVec: std_msg__Float64MultiArray = {
      layout: {
            dim:{
            label: "",
            size: 0,
            stride: 0
      },
      data_offset: 0
      },
      data: angularSpeed
    };


    let message: std_msg__Float64MultiArray;
    const schemaName = currentTopicRef.current?.schemaName ?? "";
    if ([VEL_CMD_SCHEMA_ROS_1, VEL_CMD_SCHEMA_ROS_2].includes(schemaName)) {
      message = angularVec;
      message = linearVec;
    } else {
      console.error("Unknown message schema");
      return;
    }
    if (currentTopicRef.current?.name) {
      context.publish?.(currentTopicRef.current.name, message);
    }
  }, [config, context]);

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
      startPoint = data.position;
      nextCmdIntervalId.current = setInterval(cmdMove, 1000 / config.publishRate);
    });
    // nipple_move
    nippleManagerRef.current.on("move", (_, data) => {
      const x = startPoint.x - data.position.x;
      const y = startPoint.y - data.position.y;
      // X 
      const resultX = (x / 100) * 1.5707;
      // Y 
      const resultY = (y / 100) * 1.0;
      nextCmdPt.current = [resultY, resultX];
      lastPoint = data.position;
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
  }, [colorScheme, cmdMove, config.publishRate]);

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

    context.onRender = (renderState: RenderState, done:() => void) => {
      // render functions receive a _done_ callback. You MUST call this callback to indicate your panel has finished rendering.
      // Your panel will not receive another render callback until _done_ is called from a prior render. If your panel is not done
      // rendering before the next render call, studio shows a notification to the user that your panel is delayed.

      // Set the done callback into a state variable to trigger a re-render.
      setRenderDone(() => done);

      // We may have new topics - since we are also watching for messages in the current frame, topics may not have changed
      // It is up to you to determine the correct action when state has not changed.


      setTopics(
        renderState.topics?.filter(({ schemaName }) => {
          return [
            VEL_CMD_SCHEMA_ROS_1,
            VEL_CMD_SCHEMA_ROS_2,
          ].includes(schemaName);
        }) ?? [],
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
