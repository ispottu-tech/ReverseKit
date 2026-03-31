import { Router, type IRouter } from "express";
import healthRouter from "./health";
import fridaRouter from "./frida";
import binaryRouter from "./binary";

const router: IRouter = Router();

router.use(healthRouter);
router.use(fridaRouter);
router.use(binaryRouter);

export default router;
