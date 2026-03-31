import { Router, type IRouter } from "express";
import healthRouter from "./health";
import fridaRouter from "./frida";

const router: IRouter = Router();

router.use(healthRouter);
router.use(fridaRouter);

export default router;
