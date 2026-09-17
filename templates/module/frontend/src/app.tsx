import type { ToolNestModuleRouteRenderProps } from "@toolnest/react-module-sdk";
import { RiArrowRightLine, RiCheckboxCircleLine, RiSettings3Line } from "@remixicon/react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { ModuleLayout } from "./components/module-layout";

export function ModuleApp(props: ToolNestModuleRouteRenderProps) {
  const settings = props.path === "settings";
  return (
    <ModuleLayout {...props}>
      {settings ? <SettingsPage /> : <OverviewPage router={props.router} />}
    </ModuleLayout>
  );
}

function OverviewPage({ router }: { router: ToolNestModuleRouteRenderProps["router"] }) {
  return (
    <div className="tn-{{MODULE_ID}}__content">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>开始开发</CardTitle>
            <CardDescription>
              这是一个最小可运行的 React 模块页面，业务内容从这里开始扩展。
            </CardDescription>
          </div>
          <CardAction>
            <Badge variant="secondary">
              <RiCheckboxCircleLine data-icon="inline-start" />
              模板就绪
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent>
          <p className="tn-{{MODULE_ID}}__muted">
            请在 routes、api、types 和后端 service 中按领域增加代码，并保持模块边界清晰。
          </p>
        </CardContent>
        <CardFooter>
          <Button
            size="sm"
            onClick={() => void router.push("/modules/{{MODULE_ID}}/settings")}
          >
            查看设置示例
            <RiArrowRightLine data-icon="inline-end" />
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

function SettingsPage() {
  return (
    <div className="tn-{{MODULE_ID}}__content">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>设置示例</CardTitle>
            <CardDescription>
              使用 Field、Input、Select 等 shadcn 组件补充真实配置字段。
            </CardDescription>
          </div>
          <CardAction>
            <RiSettings3Line aria-hidden="true" />
          </CardAction>
        </CardHeader>
        <CardContent>
          <p className="tn-{{MODULE_ID}}__muted">
            模板不预设业务配置，避免把具体模块的状态模型带入新模块。
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
