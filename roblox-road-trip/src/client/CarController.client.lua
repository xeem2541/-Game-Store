--[[
	CarController (LocalScript) -> StarterPlayer > StarterPlayerScripts
	ควบคุมรถของตัวเองแบบอาร์เคด: คำนวณแรงขับ แรงเกาะข้าง การเลี้ยว การทรงตัว
	แล้วป้อนเข้า VectorForce / Torque ที่ฝั่งเซิร์ฟเวอร์สร้างไว้ในรถ
]]

local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local Workspace = game:GetService("Workspace")

local player = Players.LocalPlayer
local rayParams = RaycastParams.new()
rayParams.FilterType = Enum.RaycastFilterType.Exclude

local wheelAngle = {} -- [weld] = มุมสะสม
local lastSerial = 0
local lastSeat = nil

local function clearDrive(seat)
	local f = seat:FindFirstChild("DriveForce")
	local t = seat:FindFirstChild("DriveTorque")
	if f then
		f.Force = Vector3.zero
	end
	if t then
		t.Torque = Vector3.zero
	end
end

local function mySeat()
	local char = player.Character
	local hum = char and char:FindFirstChildOfClass("Humanoid")
	local seat = hum and hum.SeatPart
	if seat and seat:IsA("VehicleSeat") and seat.Parent:GetAttribute("OwnerUserId") == player.UserId then
		return seat
	end
	return nil
end

RunService.Heartbeat:Connect(function(dt)
	local seat = mySeat()
	if not seat then
		if lastSeat and lastSeat.Parent then
			clearDrive(lastSeat)
		end
		lastSeat = nil
		return
	end
	lastSeat = seat

	local model = seat.Parent
	local force = seat:FindFirstChild("DriveForce")
	local torque = seat:FindFirstChild("DriveTorque")
	if not force or not torque then
		return
	end

	local A = function(name)
		return model:GetAttribute(name) or 0
	end
	local mass = seat.AssemblyMass
	local cf = seat.CFrame
	local v = seat.AssemblyLinearVelocity
	local w = seat.AssemblyAngularVelocity

	-- พื้นใต้รถ
	rayParams.FilterDescendantsInstances = { model, player.Character }
	local hit = Workspace:Raycast(cf.Position, -cf.UpVector * 6, rayParams)
	local grounded = hit ~= nil
	local n = grounded and hit.Normal or Vector3.yAxis

	local look = cf.LookVector
	local fwd = look - n * look:Dot(n)
	fwd = fwd.Magnitude > 1e-3 and fwd.Unit or look
	local right = fwd:Cross(n)
	local vf, vr = v:Dot(fwd), v:Dot(right)

	local throttle, steer = seat.ThrottleFloat, seat.SteerFloat
	local boosting = Workspace:GetServerTimeNow() < A("BoostUntil")
	local mult = boosting and A("BoostMult") or 1
	local maxSpeed = A("MaxSpeed") * mult

	-- แรงเตะตอนเหยียบแผ่นบูสต์
	local serial = A("BoostSerial")
	if serial ~= lastSerial then
		lastSerial = serial
		if serial > 0 then
			seat:ApplyImpulse(fwd * mass * A("BoostKick"))
		end
	end

	-- อัตราเร่งตามแนวหน้า-หลัง
	local accel = 0
	if grounded then
		if throttle > 0.05 then
			if vf < -1 then
				accel = A("BrakeAccel") * throttle
			else
				accel = A("Accel") * mult * throttle * math.clamp(1 - math.max(vf, 0) / maxSpeed, 0, 1)
			end
		elseif throttle < -0.05 then
			if vf > 1 then
				accel = A("BrakeAccel") * throttle
			else
				accel = A("Accel") * 0.6 * throttle * math.clamp(1 - (-vf) / A("ReverseSpeed"), 0, 1)
			end
		else
			accel = -vf * 1.2 -- ปล่อยคันเร่ง: ชะลอเอง
		end
	end

	local acc = fwd * accel
	if grounded then
		acc = acc - right * vr * A("Grip") -- เกาะถนน กันไถล
		local speedRatio = math.clamp(v.Magnitude / maxSpeed, 0, 1)
		acc = acc - n * (15 + 30 * speedRatio) -- ดูดลงพื้น
		if math.abs(throttle) < 0.05 and v.Magnitude < 4 then
			-- จอดบนเนิน: หักล้างแรงโน้มถ่วงที่ไถลตามพื้น
			local g = Vector3.new(0, -Workspace.Gravity, 0)
			acc = acc - (g - n * g:Dot(n))
		end
	end
	force.Force = acc * mass

	-- ทรงตัว (ให้ขนานพื้น) + เลี้ยว
	local I = mass * 10
	local target = grounded and n or Vector3.yAxis
	local tilt = cf.UpVector:Cross(target)
	local wTilt = w - target * w:Dot(target)
	local tiltGain = grounded and 1 or 0.4
	local dir = vf >= 0 and 1 or -1
	local speedFactor = math.clamp(math.abs(vf) / 20, 0, 1)
	local turn = -steer * A("TurnRate") * speedFactor * dir * (1 - 0.35 * math.clamp(math.abs(vf) / maxSpeed, 0, 1))
	local yawErr = turn - w:Dot(target)
	local tau = (tilt * 20 - wTilt * 8) * I * tiltGain
	if grounded then
		tau = tau + target * yawErr * 10 * I
	end
	torque.Torque = tau

	-- หมุนล้อ + เลี้ยวล้อหน้า (สวยงามเท่านั้น)
	for _, weld in ipairs(seat:GetChildren()) do
		if weld:IsA("Weld") and weld.Name:sub(1, 10) == "WheelWeld_" then
			local base = weld:GetAttribute("Base")
			if base then
				local ang = (wheelAngle[weld] or 0) - vf / 1.5 * dt
				wheelAngle[weld] = ang
				local yaw = weld:GetAttribute("Front") and (-steer * 0.45) or 0
				weld.C0 = base * CFrame.Angles(0, yaw, 0) * CFrame.Angles(ang, 0, 0)
			end
		end
	end
end)
